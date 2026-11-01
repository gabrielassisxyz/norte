package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

// ReadCookieFile reads the per-host cookie file: a JSON object mapping a host to
// a complete Cookie header value. Keys are lowercased so a lookup by a
// lowercased host is exact.
//
// The file holds credentials, so no error returned here carries any of its
// content: not a value, not a key, not even the character a JSON syntax error
// stopped at. A failure names the path and a byte offset, which is enough to
// find the mistake in an editor and nothing an attacker reading a log could use.
func ReadCookieFile(path string) (map[string]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("reading the cookie file %s: %w", path, err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("the cookie file %s must be readable by the owner only "+
			"(mode %04o); restrict it with chmod 600", path, info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading the cookie file %s: %w", path, err)
	}
	var parsed map[string]string
	if err := json.Unmarshal(raw, &parsed); err != nil {
		var syntax *json.SyntaxError
		var wrongType *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syntax):
			return nil, fmt.Errorf("the cookie file %s is not valid JSON (at byte %d)", path, syntax.Offset)
		case errors.As(err, &wrongType):
			return nil, fmt.Errorf("the cookie file %s must map each host to a string (at byte %d)", path, wrongType.Offset)
		default:
			return nil, fmt.Errorf("the cookie file %s could not be read as a JSON object of strings", path)
		}
	}
	cookies := make(map[string]string, len(parsed))
	for host, header := range parsed {
		cookies[strings.ToLower(host)] = header
	}
	return cookies, nil
}
