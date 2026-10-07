package library

import (
	"fmt"
	"net/url"
	"strings"
)

// libraryTrackingParams are the query parameters a canonical URL drops: the
// marketing trackers and the one bare affiliate marker. A parameter whose name
// starts with utm_ is tracking whatever follows the prefix.
var libraryTrackingParams = map[string]bool{
	"fbclid": true,
	"gclid":  true,
	"mc_cid": true,
	"mc_eid": true,
	"ref":    true,
}

// ValidateItemURL parses raw as an absolute http or https URL with a hostname
// and no embedded credentials. Anything else -- a relative reference, a
// malformed value, another scheme, userinfo in the authority -- is a save that
// must change nothing, so this runs before any blob is stored or transaction
// opened, and the caller maps the failure to a 400 naming the url.
func ValidateItemURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("the url does not parse: %w", err)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
	default:
		return nil, fmt.Errorf("the url must be absolute http or https")
	}
	if parsed.Hostname() == "" {
		return nil, fmt.Errorf("the url has no hostname")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("the url must not carry credentials")
	}
	return parsed, nil
}

// CanonicalizeItemURL returns the dedupe key for a validated URL: the tracking
// parameters and the fragment removed, the host lowercased. Two saves of one
// page through different trackers or scrolled to different anchors are one
// item because they canonicalize to one key, and the UNIQUE index on the
// column is what concurrent saves resolve through.
func CanonicalizeItemURL(parsed *url.URL) string {
	trimmed := *parsed
	trimmed.Host = strings.ToLower(trimmed.Host)
	query := trimmed.Query()
	for name := range query {
		if strings.HasPrefix(strings.ToLower(name), "utm_") || libraryTrackingParams[strings.ToLower(name)] {
			query.Del(name)
		}
	}
	trimmed.RawQuery = query.Encode()
	trimmed.Fragment = ""
	trimmed.RawFragment = ""
	return trimmed.String()
}
