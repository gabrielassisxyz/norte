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
