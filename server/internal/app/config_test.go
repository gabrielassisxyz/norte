package app

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// envFromMap builds the loader's view of the environment, so no test has to
// mutate the process it runs in.
func envFromMap(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

func writeConfigFile(t *testing.T, contents string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatalf("writing the config file: %v", err)
	}
	// WriteFile is subject to the umask, so the mode is set explicitly.
	if err := os.Chmod(path, mode); err != nil {
		t.Fatalf("setting the config file mode: %v", err)
	}
	return path
}

func TestLoadPrefersFlagOverEnvOverFileOverDefault(t *testing.T) {
	file := writeConfigFile(t, "listen = \"127.0.0.1:3000\"\n", 0o600)

	cases := []struct {
		name       string
		flags      map[string]string
		env        map[string]string
		configPath string
		wantValue  string
		wantSource Source
	}{
		{name: "default", wantValue: "127.0.0.1:8080", wantSource: SourceDefault},
		{name: "file", configPath: file, wantValue: "127.0.0.1:3000", wantSource: SourceFile},
		{
			name: "env over file", configPath: file,
			env:       map[string]string{"NORTE_LISTEN": "127.0.0.1:4000"},
			wantValue: "127.0.0.1:4000", wantSource: SourceEnv,
		},
		{
			name: "flag over env and file", configPath: file,
			env:       map[string]string{"NORTE_LISTEN": "127.0.0.1:4000"},
			flags:     map[string]string{"listen": "127.0.0.1:5000"},
			wantValue: "127.0.0.1:5000", wantSource: SourceFlag,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			cfg, _, err := Load(LoadOptions{
				Flags:      test.flags,
				Env:        envFromMap(test.env),
				Home:       "/home/tester",
				ConfigPath: test.configPath,
			})
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if cfg.Listen != test.wantValue {
				t.Errorf("Listen = %q, want %q", cfg.Listen, test.wantValue)
			}
			if got := cfg.Sources["listen"]; got != test.wantSource {
				t.Errorf("source = %q, want %q", got, test.wantSource)
			}
		})
	}
}

func TestLoadExpandsATildeInThePathSettings(t *testing.T) {
	cfg, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_DATA": "~/x"}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if want := "/home/tester/x"; cfg.Data != want {
		t.Errorf("Data = %q, want %q", cfg.Data, want)
	}
}

func TestLoadDefaultsTheDataDirectoryBelowTheHomeDirectory(t *testing.T) {
	cfg, _, err := Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester"})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if want := "/home/tester/.local/share/norte"; cfg.Data != want {
		t.Errorf("Data = %q, want %q", cfg.Data, want)
	}

	cfg, _, err = Load(LoadOptions{
		Env:  envFromMap(map[string]string{"XDG_DATA_HOME": "/data"}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if want := "/data/norte"; cfg.Data != want {
		t.Errorf("Data = %q, want %q", cfg.Data, want)
	}
}

func TestReportHidesSecretValuesAndNamesEverySource(t *testing.T) {
	cfg, _, err := Load(LoadOptions{
		Env: envFromMap(map[string]string{
			"NORTE_LLM_KEY":        "topsecretvalue",
			"NORTE_TELEGRAM_TOKEN": "anothersecretvalue",
		}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	report := cfg.Report()
	for _, leaked := range []string{"topsecretvalue", "anothersecretvalue"} {
		if strings.Contains(report, leaked) {
			t.Errorf("report leaks %q:\n%s", leaked, report)
		}
	}
	if !strings.Contains(report, "llm_key") || !strings.Contains(report, RedactedValue) {
		t.Errorf("report does not show llm_key as hidden:\n%s", report)
	}
	for _, s := range settings {
		if !strings.Contains(report, s.name) {
			t.Errorf("report omits the setting %q", s.name)
		}
		if cfg.Sources[s.name] == "" {
			t.Errorf("setting %q has no recorded source", s.name)
		}
	}
	if !strings.Contains(report, "(env)") || !strings.Contains(report, "(default)") {
		t.Errorf("report does not name the sources:\n%s", report)
	}
}

func TestLoadWarnsAboutASecretInAGroupReadableConfigFile(t *testing.T) {
	loose := writeConfigFile(t, "llm_key = \"topsecretvalue\"\n", 0o644)
	_, warnings, err := Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester", ConfigPath: loose})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(warnings) != 1 {
		t.Fatalf("warnings = %v, want exactly one", warnings)
	}
	if !strings.Contains(warnings[0], loose) {
		t.Errorf("warning does not name the file %q: %s", loose, warnings[0])
	}

	tight := writeConfigFile(t, "llm_key = \"topsecretvalue\"\n", 0o600)
	_, warnings, err = Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester", ConfigPath: tight})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none for a 0600 file", warnings)
	}
}

func TestLoadDoesNotWarnAboutALooseFileWithoutSecrets(t *testing.T) {
	path := writeConfigFile(t, "listen = \"127.0.0.1:3000\"\n", 0o644)
	_, warnings, err := Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester", ConfigPath: path})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(warnings) != 0 {
		t.Errorf("warnings = %v, want none: the file holds no secret", warnings)
	}
}

func TestSecretsHaveNoCommandLineFlag(t *testing.T) {
	root := NewRootCommand()
	for _, name := range []string{"llm-key", "telegram-token"} {
		if flag := root.PersistentFlags().Lookup(name); flag != nil {
			t.Errorf("--%s exists: a flag is readable by every process on the machine", name)
		}
	}
	// The non-secret settings must still be reachable from the command line.
	for _, s := range settings {
		flag := root.PersistentFlags().Lookup(s.flag)
		if s.secret && s.flag != "" {
			t.Errorf("secret setting %q declares the flag --%s", s.name, s.flag)
		}
		if !s.secret && flag == nil {
			t.Errorf("setting %q has no flag --%s", s.name, s.flag)
		}
	}
}

func TestAllowedHostsCoverLoopbackTheListenAddressAndThePublicURL(t *testing.T) {
	cfg, _, err := Load(LoadOptions{
		Env: envFromMap(map[string]string{
			"NORTE_LISTEN":     "192.168.1.10:9000",
			"NORTE_PUBLIC_URL": "https://norte.example:8443/",
		}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	hosts := cfg.AllowedHosts()
	for _, want := range []string{"localhost", "127.0.0.1", "[::1]", "192.168.1.10", "norte.example"} {
		if !slices.Contains(hosts, want) {
			t.Errorf("AllowedHosts = %v, want it to contain %q", hosts, want)
		}
	}
}

func TestLoadRejectsAnUnparseableByteCount(t *testing.T) {
	_, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_BODY_MAX_BYTES": "plenty"}),
		Home: "/home/tester",
	})
	if err == nil {
		t.Fatal("Load accepted a body cap that is not a number")
	}
	if !strings.Contains(err.Error(), "body_max_bytes") {
		t.Errorf("error does not name the setting: %v", err)
	}
}

func TestConfigCommandPrintsTheReport(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("NORTE_LLM_KEY", "topsecretvalue")
	t.Setenv("NORTE_LISTEN", "127.0.0.1:7777")

	root := NewRootCommand()
	var stdout, stderr bytes.Buffer
	root.SetOut(&stdout)
	root.SetErr(&stderr)
	root.SetArgs([]string{"config"})
	if err := root.Execute(); err != nil {
		t.Fatalf("norte config: %v (stderr %q)", err, stderr.String())
	}

	out := stdout.String()
	if strings.Contains(out, "topsecretvalue") {
		t.Errorf("norte config leaks the secret:\n%s", out)
	}
	if !strings.Contains(out, "127.0.0.1:7777") || !strings.Contains(out, "(env)") {
		t.Errorf("norte config does not report the value and its source:\n%s", out)
	}
}

func TestLoadRejectsAnUnknownTimezoneFromEnvFlagAndFile(t *testing.T) {
	_, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_TIMEZONE": "Mars/Olympus"}),
		Home: "/home/tester",
	})
	if err == nil {
		t.Fatal("Load accepted an unknown timezone from the environment")
	}
	if !strings.Contains(err.Error(), "timezone") || !strings.Contains(err.Error(), "Mars/Olympus") {
		t.Errorf("error does not name the setting and the bad value: %v", err)
	}

	_, _, err = Load(LoadOptions{
		Env:   envFromMap(nil),
		Home:  "/home/tester",
		Flags: map[string]string{"timezone": "Mars/Olympus"},
	})
	if err == nil {
		t.Fatal("Load accepted an unknown timezone from the flag")
	}
	if !strings.Contains(err.Error(), "timezone") || !strings.Contains(err.Error(), "Mars/Olympus") {
		t.Errorf("error does not name the setting and the bad value: %v", err)
	}

	file := writeConfigFile(t, "timezone = \"Mars/Olympus\"\n", 0o600)
	_, _, err = Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester", ConfigPath: file})
	if err == nil {
		t.Fatal("Load accepted an unknown timezone from the config file")
	}
	if !strings.Contains(err.Error(), "timezone") || !strings.Contains(err.Error(), "Mars/Olympus") {
		t.Errorf("error does not name the setting and the bad value: %v", err)
	}
}

func TestLoadAcceptsAKnownTimezoneAndAnEmptyOne(t *testing.T) {
	for _, zone := range []string{"America/Sao_Paulo", "UTC"} {
		cfg, _, err := Load(LoadOptions{
			Env:  envFromMap(map[string]string{"NORTE_TIMEZONE": zone}),
			Home: "/home/tester",
		})
		if err != nil {
			t.Errorf("Load rejected the known zone %q: %v", zone, err)
			continue
		}
		if cfg.Timezone != zone {
			t.Errorf("Timezone = %q, want %q", cfg.Timezone, zone)
		}
	}

	cfg, _, err := Load(LoadOptions{
		Env:   envFromMap(nil),
		Home:  "/home/tester",
		Flags: map[string]string{"timezone": ""},
	})
	if err != nil {
		t.Fatalf("Load rejected an empty timezone: %v", err)
	}
	if cfg.Timezone != "" {
		t.Errorf("Timezone = %q, want the empty system default", cfg.Timezone)
	}
}

func TestReportRedactsTheCredentialsInTheLLMURL(t *testing.T) {
	raw := "http://u:pw@127.0.0.1:1/v1?api_key=SECRET"
	cfg, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_LLM_URL": raw}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.LLMURL != raw {
		t.Errorf("LLMURL = %q, want the raw value kept for the client", cfg.LLMURL)
	}

	report := cfg.Report()
	for _, leaked := range []string{"u:pw@", "api_key=SECRET", "SECRET"} {
		if strings.Contains(report, leaked) {
			t.Errorf("report leaks %q:\n%s", leaked, report)
		}
	}
	if !strings.Contains(report, "http://<hidden>@127.0.0.1:1/v1?<hidden>") {
		t.Errorf("report does not redact the userinfo and the query:\n%s", report)
	}

	plain := "http://127.0.0.1:1/v1"
	cfg, _, err = Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_LLM_URL": plain}),
		Home: "/home/tester",
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if report := cfg.Report(); !strings.Contains(report, plain) {
		t.Errorf("report changed a URL with no credentials %q:\n%s", plain, report)
	}
}
func TestSystemZoneNamesALoadableZone(t *testing.T) {
	if got := systemZone("America/Sao_Paulo", "/nonexistent"); got != "America/Sao_Paulo" {
		t.Errorf("from TZ: got %q", got)
	}
	if got := systemZone(":Europe/Lisbon", "/nonexistent"); got != "Europe/Lisbon" {
		t.Errorf("from TZ with a leading colon: got %q", got)
	}
	dir := t.TempDir()
	zone := filepath.Join(dir, "zoneinfo", "Asia", "Tokyo")
	if err := os.MkdirAll(filepath.Dir(zone), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(zone, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "localtime")
	if err := os.Symlink(zone, link); err != nil {
		t.Fatal(err)
	}
	if got := systemZone("", link); got != "Asia/Tokyo" {
		t.Errorf("from the localtime link: got %q", got)
	}
	if got := systemZone("", filepath.Join(dir, "missing")); got != "UTC" {
		t.Errorf("fallback: got %q", got)
	}
	if got := systemZone("", "/etc/localtime"); got == "Local" {
		t.Errorf("the default must never be Go's placeholder %q", got)
	}
}
