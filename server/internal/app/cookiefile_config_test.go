package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeCookieFile(t *testing.T, contents string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cookies.json")
	if err := os.WriteFile(path, []byte(contents), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}

func loadWithCookieFile(path string) (*Config, error) {
	cfg, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_COOKIE_FILE": path}),
		Home: "/home/tester",
	})
	return cfg, err
}

func TestLoadRefusesACookieFileOthersCanRead(t *testing.T) {
	for _, mode := range []os.FileMode{0o640, 0o644, 0o604, 0o666} {
		path := writeCookieFile(t, `{"pages.test": "sid=SECRETVALUE"}`, mode)
		_, err := loadWithCookieFile(path)
		if err == nil {
			t.Fatalf("mode %04o was accepted", mode)
		}
		if !strings.Contains(err.Error(), path) || !strings.Contains(err.Error(), "owner only") {
			t.Errorf("mode %04o: the message does not name the path and the rule: %v", mode, err)
		}
		if strings.Contains(err.Error(), "SECRETVALUE") {
			t.Errorf("the message carries the cookie value: %v", err)
		}
	}
}

func TestLoadAcceptsAnOwnerOnlyCookieFile(t *testing.T) {
	for _, mode := range []os.FileMode{0o600, 0o400} {
		path := writeCookieFile(t, `{"pages.test": "a=1", "Other.test": "b=2"}`, mode)
		cfg, err := loadWithCookieFile(path)
		if err != nil {
			t.Fatalf("mode %04o: %v", mode, err)
		}
		if cfg.CookieFile != path || cfg.cookieHosts != 2 {
			t.Errorf("CookieFile = %q with %d hosts", cfg.CookieFile, cfg.cookieHosts)
		}
	}
}

func TestLoadRefusesAMalformedCookieFileWithoutQuotingIt(t *testing.T) {
	for name, content := range map[string]string{
		"invalid json": `{"pages.test": "sid=SECRETVALUE",}`,
		"non-string":   `{"pages.test": 99887766, "x.test": "sid=SECRETVALUE"}`,
	} {
		path := writeCookieFile(t, content, 0o600)
		_, err := loadWithCookieFile(path)
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
		if !strings.Contains(err.Error(), path) || !strings.Contains(err.Error(), "at byte") {
			t.Errorf("%s: the message lacks the path or the position: %v", name, err)
		}
		for _, leak := range []string{"SECRETVALUE", "99887766", "x.test", "pages.test"} {
			if strings.Contains(err.Error(), leak) {
				t.Errorf("%s: the message carries file content %q: %v", name, leak, err)
			}
		}
	}
}

func TestLoadExpandsATildeInTheCookieFilePath(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "c.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, _, err := Load(LoadOptions{
		Env:  envFromMap(map[string]string{"NORTE_COOKIE_FILE": "~/c.json"}),
		Home: home,
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, "c.json"); cfg.CookieFile != want {
		t.Errorf("CookieFile = %q, want %q", cfg.CookieFile, want)
	}
}

func TestReportShowsTheCookiePathAndHostCountOnly(t *testing.T) {
	unset, _, err := Load(LoadOptions{Env: envFromMap(nil), Home: "/home/tester"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(unset.Report(), "cookie_file") || !strings.Contains(unset.Report(), "unset") {
		t.Errorf("the unset report does not say so:\n%s", unset.Report())
	}

	path := writeCookieFile(t, `{"pages.test": "sid=SECRETVALUE", "other.test": "b=2"}`, 0o600)
	cfg, err := loadWithCookieFile(path)
	if err != nil {
		t.Fatal(err)
	}
	report := cfg.Report()
	if !strings.Contains(report, path+" (2 hosts)") {
		t.Errorf("the report lacks the path and count:\n%s", report)
	}
	for _, leak := range []string{"SECRETVALUE", "pages.test", "other.test", "b=2"} {
		if strings.Contains(report, leak) {
			t.Errorf("the report carries %q:\n%s", leak, report)
		}
	}
}
