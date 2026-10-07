package app

import (
	"bytes"
	"net"
	"testing"
	"time"
)

// A serve that fails to start after migrating must exit with the error rather
// than wait forever on adapters and a worker that only stop on cancellation.
func TestServeExitsWhenTheListenAddressIsTaken(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()

	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("NORTE_DATA", t.TempDir())
	t.Setenv("NORTE_LISTEN", taken.Addr().String())

	root := NewRootCommand()
	var out bytes.Buffer
	root.SetOut(&out)
	root.SetErr(&out)
	root.SetArgs([]string{"serve"})

	done := make(chan error, 1)
	go func() { done <- root.Execute() }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("serve on a taken address returned no error")
		}
	case <-time.After(15 * time.Second):
		t.Fatal("serve on a taken address hung instead of exiting")
	}
}
