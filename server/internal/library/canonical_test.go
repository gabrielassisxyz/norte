package library

import (
	"testing"
)

func TestCanonicalURLStripsTrackersFragmentAndLowercasesTheHost(t *testing.T) {
	cases := []struct {
		name  string
		raw   string
		want  string
		valid bool
	}{
		{
			name:  "tracker and fragment go",
			raw:   "https://example.org/a?utm_source=x#top",
			want:  "https://example.org/a",
			valid: true,
		},
		{
			name:  "host lowercases, path keeps its case",
			raw:   "https://EXAMPLE.org/A",
			want:  "https://example.org/A",
			valid: true,
		},
		{
			name:  "known trackers go, other parameters stay",
			raw:   "http://example.org/a?fbclid=1&x=2&gclid=3&mc_cid=4&mc_eid=5&ref=6&utm_medium=cpc",
			want:  "http://example.org/a?x=2",
			valid: true,
		},
		{
			name:  "a bare utm prefix of any length goes",
			raw:   "https://example.org/a?utm_whatever=z&keep=1",
			want:  "https://example.org/a?keep=1",
			valid: true,
		},
		{
			name:  "a parameter merely containing utm stays",
			raw:   "https://example.org/a?utmx=1",
			want:  "https://example.org/a?utmx=1",
			valid: true,
		},
		{
			name:  "a semicolon pair is kept",
			raw:   "https://example.com/?page=1;lang=pt",
			want:  "https://example.com/?page=1;lang=pt",
			valid: true,
		},
		{
			name:  "a different semicolon pair is a different key",
			raw:   "https://example.com/?page=2;lang=en",
			want:  "https://example.com/?page=2;lang=en",
			valid: true,
		},
		{
			name:  "a tracker goes but a semicolon pair stays",
			raw:   "https://example.com/?utm_source=x&page=1;lang=pt",
			want:  "https://example.com/?page=1;lang=pt",
			valid: true,
		},
		{
			name:  "a fragment goes with a semicolon pair",
			raw:   "https://example.com/?page=1;lang=pt#top",
			want:  "https://example.com/?page=1;lang=pt",
			valid: true,
		},
		{
			name:  "the query sorts",
			raw:   "https://example.com/?b=2&a=1",
			want:  "https://example.com/?a=1&b=2",
			valid: true,
		},
		{
			name:  "an uppercase host with the default https port normalises",
			raw:   "HTTPS://Example.COM:443/",
			want:  "https://example.com/",
			valid: true,
		},
		{
			name:  "an empty path becomes a slash",
			raw:   "https://example.com",
			want:  "https://example.com/",
			valid: true,
		},
		{
			name:  "a trailing slash stays",
			raw:   "https://example.com/",
			want:  "https://example.com/",
			valid: true,
		},
		{
			name:  "an empty path with a query gains a slash",
			raw:   "https://example.com?a=1",
			want:  "https://example.com/?a=1",
			valid: true,
		},
		{
			name:  "the http default port drops",
			raw:   "http://example.com:80/x",
			want:  "http://example.com/x",
			valid: true,
		},
		{
			name:  "a non-default http port is kept",
			raw:   "http://example.com:8080/x",
			want:  "http://example.com:8080/x",
			valid: true,
		},
		{
			name:  "a non-default https port is kept",
			raw:   "https://example.com:8443/",
			want:  "https://example.com:8443/",
			valid: true,
		},
		{
			name:  "the http port on https is kept",
			raw:   "https://example.com:80/",
			want:  "https://example.com:80/",
			valid: true,
		},
		{name: "relative reference is refused", raw: "/a", valid: false},
		{name: "empty is refused", raw: "", valid: false},
		{name: "a bare word is refused", raw: "notaurl", valid: false},
		{name: "file is refused", raw: "file:///etc/passwd", valid: false},
		{name: "javascript is refused", raw: "javascript:alert(1)", valid: false},
		{name: "credentials are refused", raw: "https://user:pass@example.org/", valid: false},
		{name: "a bare username is refused", raw: "https://user@example.org/", valid: false},
		{name: "no hostname is refused", raw: "https:///a", valid: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := ValidateItemURL(tc.raw)
			if !tc.valid {
				if err == nil {
					t.Fatalf("ValidateItemURL(%q) succeeded, want a refusal", tc.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("ValidateItemURL(%q): %v", tc.raw, err)
			}
			if got := CanonicalizeItemURL(parsed); got != tc.want {
				t.Errorf("canonical(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}
