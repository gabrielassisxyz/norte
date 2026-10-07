package app_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestSIGTERMLetsAnInFlightRequestFinish exercises graceful shutdown against the
// real binary, in a real process. It cannot be done in-process: the behaviour
// under test is a signal handler the serve command installs, and the in-flight
// request has to be one the operating system delivered to a listener that is
// then closed to new connections.
func TestSIGTERMLetsAnInFlightRequestFinish(t *testing.T) {
	if testing.Short() {
		t.Skip("builds and starts the binary")
	}

	server := startNorteServe(t, buildNorteBinary(t))

	// The hold route stays in flight for two seconds. Shutdown stops accepting
	// new connections, so a request meant to outlive the signal cannot be
	// released from outside once the signal is sent.
	type result struct {
		status int
		body   string
		err    error
	}
	finished := make(chan result, 1)
	go func() {
		response, err := http.Get(server.baseURL + "/api/test/hold?ms=2000")
		if err != nil {
			finished <- result{err: err}
			return
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		finished <- result{status: response.StatusCode, body: string(raw), err: err}
	}()

	// Give the request time to reach the handler, so SIGTERM really lands
	// mid-request rather than before it.
	time.Sleep(300 * time.Millisecond)
	if err := server.command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("sending SIGTERM: %v", err)
	}

	select {
	case got := <-finished:
		if got.err != nil {
			t.Fatalf("the in-flight request failed instead of completing: %v\n%s", got.err, server.log())
		}
		if got.status != http.StatusOK {
			t.Fatalf("in-flight request = %d %q, want 200", got.status, got.body)
		}
		if !strings.Contains(got.body, `"held":true`) {
			t.Errorf("in-flight response = %q, want the hold route's body", got.body)
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("the in-flight request never completed after SIGTERM\n%s", server.log())
	}

	waited := make(chan error, 1)
	go func() { waited <- server.command.Wait() }()
	select {
	case err := <-waited:
		if err != nil {
			t.Fatalf("the process exited with an error: %v\n%s", err, server.log())
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("the process did not exit after draining\n%s", server.log())
	}
	if code := server.command.ProcessState.ExitCode(); code != 0 {
		t.Errorf("exit code = %d, want 0\n%s", code, server.log())
	}

	// A request sent after the signal must not be served: shutdown stops
	// accepting, which is what separates draining from merely waiting.
	if _, err := http.Get(server.baseURL + "/api/health"); err == nil {
		t.Errorf("the server still accepted a connection after shutting down\n%s", server.log())
	}
}

func buildNorteBinary(t *testing.T) string {
	t.Helper()
	binary := filepath.Join(t.TempDir(), "norte")
	build := exec.Command("go", "build", "-o", binary, "../../cmd/norte")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return binary
}

// runningServer is a started `norte serve` subprocess plus the way to read what
// it logged. Its stderr goes to a file rather than a pipe, because exec.Cmd
// forbids calling Wait before every read from a pipe has finished and this test
// has to Wait while the server is still logging.
type runningServer struct {
	command *exec.Cmd
	baseURL string
	logPath string
}

func (s *runningServer) log() string {
	raw, err := os.ReadFile(s.logPath)
	if err != nil {
		return "server log unreadable: " + err.Error()
	}
	return "server log:\n" + string(raw)
}

// startNorteServe starts the binary on an ephemeral port and returns once the
// server has logged the address it actually bound. Port 0 keeps the test clear
// of whatever else is listening on this machine, and the log line is the only
// place the chosen port is published.
func startNorteServe(t *testing.T, binary string) *runningServer {
	t.Helper()

	logPath := filepath.Join(t.TempDir(), "serve.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		t.Fatalf("creating the server's log file: %v", err)
	}
	t.Cleanup(func() { _ = logFile.Close() })

	command := exec.Command(binary, "serve")
	command.Env = append(os.Environ(),
		"NORTE_LISTEN=127.0.0.1:0",
		"NORTE_TEST_ROUTES=1",
		"NORTE_DATA="+t.TempDir(),
		"XDG_CONFIG_HOME="+t.TempDir(),
	)
	command.Stderr = logFile
	command.Stdout = logFile
	if err := command.Start(); err != nil {
		t.Fatalf("starting %s serve: %v", binary, err)
	}
	server := &runningServer{command: command, logPath: logPath}
	t.Cleanup(func() {
		// Harmless once the test has already reaped the process.
		_ = command.Process.Signal(syscall.SIGKILL)
	})

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if bound := boundAddressFromLog(logPath); bound != "" {
			server.baseURL = "http://" + bound
			return server
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the server never logged a listening address\n%s", server.log())
	return nil
}

// boundAddressFromLog finds the address in the server's own "listening" line,
// which is how the test learns which port the kernel handed out.
func boundAddressFromLog(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		var decoded struct {
			Message string `json:"msg"`
			Address string `json:"addr"`
		}
		if err := json.Unmarshal([]byte(line), &decoded); err != nil {
			continue
		}
		if decoded.Message == "listening" && decoded.Address != "" {
			return decoded.Address
		}
	}
	return ""
}
