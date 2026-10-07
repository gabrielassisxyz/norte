// Package app wires Norte's configuration, command line and HTTP server.
package app

import (
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// Source records where an effective value came from, which is what `norte
// config` prints next to each setting.
type Source string

const (
	SourceDefault Source = "default"
	SourceFile    Source = "file"
	SourceEnv     Source = "env"
	SourceFlag    Source = "flag"
)

// Config is every setting the program has. Later beads only read these fields;
// the loader already knows them all.
type Config struct {
	Data          string
	Modules       []string
	Listen        string
	PublicURL     string
	Timezone      string
	LLMURL        string
	LLMModel      string
	LLMKey        string
	TelegramToken string
	TelegramChat  string
	FetchMaxBytes int64
	BodyMaxBytes  int64
	LogLevel      string

	// ConfigFile is the TOML file that was read, empty when none was.
	ConfigFile string
	// Sources maps a setting name to where its value came from.
	Sources map[string]Source
}

// LoadOptions is the loader's whole view of the outside world, so a test can
// supply an environment and a home directory without touching the process.
type LoadOptions struct {
	// Flags holds only the flags the user actually set, keyed by flag name.
	Flags map[string]string
	// Env defaults to os.Getenv.
	Env func(string) string
	// Home defaults to the user's home directory, used for ~ expansion.
	Home string
	// ConfigPath overrides the default config file location (--config).
	ConfigPath string
}

// setting describes one knob: its name in the TOML file and in `norte config`,
// its environment variable, its flag (empty when it has none), and how to parse,
// print and default it.
type setting struct {
	name   string
	env    string
	flag   string
	secret bool
	def    func(*LoadOptions) (string, error)
	parse  func(*Config, string) error
	show   func(*Config) string
}

// settings is the single source of truth for the configuration surface. A
// secret has no flag, because a flag is readable by every process on the
// machine through the process list.
var settings = []setting{
	{
		name: "data", env: "NORTE_DATA", flag: "data",
		def: func(o *LoadOptions) (string, error) {
			if xdg := o.Env("XDG_DATA_HOME"); xdg != "" {
				return filepath.Join(xdg, "norte"), nil
			}
			return filepath.Join(o.Home, ".local", "share", "norte"), nil
		},
		parse: func(c *Config, v string) error { c.Data = v; return nil },
		show:  func(c *Config) string { return c.Data },
	},
	{
		name: "modules", env: "NORTE_MODULES", flag: "modules",
		def:   func(*LoadOptions) (string, error) { return strings.Join(moduleNamesCompiledIn, ","), nil },
		parse: func(c *Config, v string) error { c.Modules = splitList(v); return nil },
		show:  func(c *Config) string { return strings.Join(c.Modules, ",") },
	},
	{
		name: "listen", env: "NORTE_LISTEN", flag: "listen",
		def:   func(*LoadOptions) (string, error) { return "127.0.0.1:8080", nil },
		parse: func(c *Config, v string) error { c.Listen = v; return nil },
		show:  func(c *Config) string { return c.Listen },
	},
	{
		name: "public_url", env: "NORTE_PUBLIC_URL", flag: "public-url",
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.PublicURL = v; return nil },
		show:  func(c *Config) string { return c.PublicURL },
	},
	{
		name: "timezone", env: "NORTE_TIMEZONE", flag: "timezone",
		def:   func(*LoadOptions) (string, error) { return time.Local.String(), nil },
		parse: func(c *Config, v string) error { c.Timezone = v; return nil },
		show:  func(c *Config) string { return c.Timezone },
	},
	{
		name: "llm_url", env: "NORTE_LLM_URL", flag: "llm-url",
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.LLMURL = v; return nil },
		show:  func(c *Config) string { return c.LLMURL },
	},
	{
		name: "llm_model", env: "NORTE_LLM_MODEL", flag: "llm-model",
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.LLMModel = v; return nil },
		show:  func(c *Config) string { return c.LLMModel },
	},
	{
		name: "llm_key", env: "NORTE_LLM_KEY", secret: true,
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.LLMKey = v; return nil },
		show:  func(c *Config) string { return c.LLMKey },
	},
	{
		name: "telegram_token", env: "NORTE_TELEGRAM_TOKEN", secret: true,
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.TelegramToken = v; return nil },
		show:  func(c *Config) string { return c.TelegramToken },
	},
	{
		name: "telegram_chat", env: "NORTE_TELEGRAM_CHAT", flag: "telegram-chat",
		def:   func(*LoadOptions) (string, error) { return "", nil },
		parse: func(c *Config, v string) error { c.TelegramChat = v; return nil },
		show:  func(c *Config) string { return c.TelegramChat },
	},
	{
		name: "fetch_max_bytes", env: "NORTE_FETCH_MAX_BYTES", flag: "fetch-max-bytes",
		def:   func(*LoadOptions) (string, error) { return "20971520", nil },
		parse: func(c *Config, v string) error { return parseBytes(v, &c.FetchMaxBytes) },
		show:  func(c *Config) string { return strconv.FormatInt(c.FetchMaxBytes, 10) },
	},
	{
		name: "body_max_bytes", env: "NORTE_BODY_MAX_BYTES", flag: "body-max-bytes",
		def:   func(*LoadOptions) (string, error) { return "67108864", nil },
		parse: func(c *Config, v string) error { return parseBytes(v, &c.BodyMaxBytes) },
		show:  func(c *Config) string { return strconv.FormatInt(c.BodyMaxBytes, 10) },
	},
	{
		name: "log_level", env: "NORTE_LOG_LEVEL", flag: "log-level",
		def:   func(*LoadOptions) (string, error) { return "info", nil },
		parse: func(c *Config, v string) error { c.LogLevel = v; return nil },
		show:  func(c *Config) string { return c.LogLevel },
	},
}

// moduleNamesCompiledIn lists the feature modules built into this binary. It is
// empty until the first module bead lands.
var moduleNamesCompiledIn = []string{}

// secretFileKeys are the TOML keys whose presence makes a world- or
// group-readable config file worth warning about.
var secretFileKeys = []string{"llm_key", "telegram_token"}

// pathSettings are expanded with expandHome, because a shell is not involved
// when a value arrives through the environment or a config file.
var pathSettings = map[string]bool{"data": true}

// Load resolves every setting, with flag over env over file over default, and
// returns the warnings `serve` should log.
func Load(opts LoadOptions) (*Config, []string, error) {
	if opts.Env == nil {
		opts.Env = os.Getenv
	}
	if opts.Home == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, nil, fmt.Errorf("resolving the home directory: %w", err)
		}
		opts.Home = home
	}

	cfg := &Config{Sources: map[string]Source{}}
	fileValues, warnings, err := readConfigFile(&opts, cfg)
	if err != nil {
		return nil, nil, err
	}

	for _, s := range settings {
		value, source, err := resolveSetting(s, &opts, fileValues)
		if err != nil {
			return nil, nil, err
		}
		if pathSettings[s.name] {
			value = expandHome(value, opts.Home)
		}
		if err := s.parse(cfg, value); err != nil {
			return nil, nil, fmt.Errorf("setting %s: %w", s.name, err)
		}
		cfg.Sources[s.name] = source
	}
	return cfg, warnings, nil
}

// resolveSetting applies the precedence order to one setting.
func resolveSetting(s setting, opts *LoadOptions, fileValues map[string]string) (string, Source, error) {
	if s.flag != "" {
		if value, ok := opts.Flags[s.flag]; ok {
			return value, SourceFlag, nil
		}
	}
	if value := opts.Env(s.env); value != "" {
		return value, SourceEnv, nil
	}
	if value, ok := fileValues[s.name]; ok {
		return value, SourceFile, nil
	}
	value, err := s.def(opts)
	if err != nil {
		return "", "", fmt.Errorf("default for %s: %w", s.name, err)
	}
	return value, SourceDefault, nil
}

// readConfigFile reads the optional TOML file and reports a warning when a file
// holding a secret is readable beyond its owner.
func readConfigFile(opts *LoadOptions, cfg *Config) (map[string]string, []string, error) {
	path := configFilePath(opts)
	if path == "" {
		return nil, nil, nil
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) && opts.ConfigPath == "" {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("reading the config file %s: %w", path, err)
	}

	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return nil, nil, fmt.Errorf("parsing the config file %s: %w", path, err)
	}
	cfg.ConfigFile = path

	values := make(map[string]string, len(raw))
	for _, s := range settings {
		value, ok := raw[s.name]
		if !ok {
			continue
		}
		text, err := tomlValueToString(value)
		if err != nil {
			return nil, nil, fmt.Errorf("config file %s: setting %s: %w", path, s.name, err)
		}
		values[s.name] = text
	}

	var warnings []string
	if warning := secretFilePermissionWarning(path, info.Mode(), raw); warning != "" {
		warnings = append(warnings, warning)
	}
	return values, warnings, nil
}

// configFilePath picks --config, then $XDG_CONFIG_HOME/norte/config.toml, then
// ~/.config/norte/config.toml.
func configFilePath(opts *LoadOptions) string {
	if opts.ConfigPath != "" {
		return expandHome(opts.ConfigPath, opts.Home)
	}
	if xdg := opts.Env("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "norte", "config.toml")
	}
	if opts.Home == "" {
		return ""
	}
	return filepath.Join(opts.Home, ".config", "norte", "config.toml")
}

// secretFilePermissionWarning names the file when it holds a secret and anyone
// but its owner can read it.
func secretFilePermissionWarning(path string, mode fs.FileMode, raw map[string]any) string {
	if mode.Perm()&0o077 == 0 {
		return ""
	}
	for _, key := range secretFileKeys {
		if _, ok := raw[key]; ok {
			return fmt.Sprintf("the config file %s holds %s and is readable by group or others (mode %04o); "+
				"restrict it with chmod 600", path, key, mode.Perm())
		}
	}
	return ""
}

// expandHome resolves a leading ~, which no shell did when the value arrived
// through the environment or a config file.
func expandHome(value, home string) string {
	if value == "~" {
		return home
	}
	if strings.HasPrefix(value, "~/") {
		return filepath.Join(home, value[2:])
	}
	return value
}

func splitList(value string) []string {
	var out []string
	for _, part := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func parseBytes(value string, target *int64) error {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return fmt.Errorf("%q is not a byte count", value)
	}
	if parsed <= 0 {
		return fmt.Errorf("%q must be positive", value)
	}
	*target = parsed
	return nil
}

func tomlValueToString(value any) (string, error) {
	switch typed := value.(type) {
	case string:
		return typed, nil
	case bool:
		return strconv.FormatBool(typed), nil
	case int64:
		return strconv.FormatInt(typed, 10), nil
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), nil
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			text, err := tomlValueToString(item)
			if err != nil {
				return "", err
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, ","), nil
	default:
		return "", fmt.Errorf("unsupported value of type %T", value)
	}
}

// RedactedValue is printed in place of a secret's value.
const RedactedValue = "<hidden>"

// Report renders the effective configuration with the origin of each value and
// every secret replaced, which is what `norte config` prints.
func (c *Config) Report() string {
	width := 0
	for _, s := range settings {
		if len(s.name) > width {
			width = len(s.name)
		}
	}
	var b strings.Builder
	for _, s := range settings {
		value := s.show(c)
		if s.secret && value != "" {
			value = RedactedValue
		}
		fmt.Fprintf(&b, "%-*s = %-24s (%s)\n", width, s.name, value, c.Sources[s.name])
	}
	if c.ConfigFile != "" {
		fmt.Fprintf(&b, "\nconfig file: %s\n", c.ConfigFile)
	}
	return b.String()
}

// flagSettings returns the settings that may be given as a flag, in a stable
// order, so the command line and the loader cannot disagree about which exist.
func flagSettings() []setting {
	out := make([]setting, 0, len(settings))
	for _, s := range settings {
		if s.flag != "" {
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].flag < out[j].flag })
	return out
}

// AllowedHosts is the Host allowlist: the loopback names plus whatever this
// server was told it is reachable as.
func (c *Config) AllowedHosts() []string {
	hosts := []string{"localhost", "127.0.0.1", "[::1]"}
	if host := hostOfAddress(c.Listen); host != "" {
		hosts = append(hosts, host)
	}
	if host := hostOfURL(c.PublicURL); host != "" {
		hosts = append(hosts, host)
	}
	return hosts
}

func hostOfAddress(address string) string {
	if address == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return address
	}
	return host
}

func hostOfURL(raw string) string {
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Hostname()
}
