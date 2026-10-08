package library

import (
	"fmt"
	"net/url"
	"sort"
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
// parameters and the fragment removed, the host lowercased, the scheme's
// default port dropped and an empty path set to "/". Two saves of one
// page through different trackers or scrolled to different anchors are one
// item because they canonicalize to one key, and the UNIQUE index on the
// column is what concurrent saves resolve through. The query is split on "&"
// and each pair's raw text is kept, so a pair containing ";" survives, where
// url.ParseQuery would silently drop it; only tracking keys are removed and
// the survivors are sorted.
func CanonicalizeItemURL(parsed *url.URL) string {
	trimmed := *parsed
	trimmed.Scheme = strings.ToLower(trimmed.Scheme)
	hostname := strings.ToLower(trimmed.Hostname())
	port := trimmed.Port()
	if (trimmed.Scheme == "http" && port == "80") || (trimmed.Scheme == "https" && port == "443") {
		port = ""
	}
	host := hostname
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		host = host + ":" + port
	}
	trimmed.Host = host
	if trimmed.Path == "" {
		trimmed.Path = "/"
	}
	rawQuery := trimmed.RawQuery
	if rawQuery == "" {
		trimmed.RawQuery = ""
	} else {
		kept := make([]string, 0, strings.Count(rawQuery, "&")+1)
		for _, pair := range strings.Split(rawQuery, "&") {
			if pair == "" {
				continue
			}
			key, value, hasValue := strings.Cut(pair, "=")
			decodedKey := libraryUnescapeQueryPart(key)
			lowered := strings.ToLower(decodedKey)
			if strings.HasPrefix(lowered, "utm_") || libraryTrackingParams[lowered] {
				continue
			}
			// Re-encoding each part the way url.Values.Encode does keeps
			// "%20" and "+" one key, as they were before pairs were kept raw,
			// so a page saved under the old rule still dedupes.
			normalized := url.QueryEscape(decodedKey)
			if hasValue {
				normalized += "=" + url.QueryEscape(libraryUnescapeQueryPart(value))
			}
			kept = append(kept, normalized)
		}
		sort.Strings(kept)
		trimmed.RawQuery = strings.Join(kept, "&")
	}
	trimmed.Fragment = ""
	trimmed.RawFragment = ""
	return trimmed.String()
}

// libraryUnescapeQueryPart decodes one key or value of a query pair, keeping
// the raw text when it is not valid percent-encoding.
func libraryUnescapeQueryPart(part string) string {
	if unescaped, err := url.QueryUnescape(part); err == nil {
		return unescaped
	}
	return part
}
