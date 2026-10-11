package core

import "testing"

// The slug is the subject's identity in a URL and the only normalised form the
// schema stores, so a search typed without accents matches against it. Each
// case below is therefore a rule the search depends on, not a formatting
// preference.
func TestSlugifyDerivesTheTypeableForm(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"lowercases", "Machine Learning", "machine-learning"},
		{"strips accents", "Programação", "programacao"},
		{"strips several accents", "Órgão Público", "orgao-publico"},
		{"keeps the cedilla's letter", "Escrita Concisa", "escrita-concisa"},
		{"drops punctuation", "C++ & Rust?", "c-rust"},
		{"collapses runs of separators", "Deep   ---  Learning", "deep-learning"},
		{"trims the edges", "  Kubernetes  ", "kubernetes"},
		{"keeps digits", "Web 3 Básico", "web-3-basico"},
		{"leaves an already-slugged name alone", "machine-learning", "machine-learning"},
		{"has nothing to derive from punctuation alone", "!!!", ""},
		{"has nothing to derive from blanks", "   ", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Slugify(testCase.in); got != testCase.want {
				t.Errorf("Slugify(%q) = %q, want %q", testCase.in, got, testCase.want)
			}
		})
	}
}

// A subject screen is reached at the slug, and the registry url is what a
// rendered link follows, so the two have to be the same address.
func TestSubjectURLIsTheScreenAddress(t *testing.T) {
	if got := subjectURL("machine-learning"); got != "/subjects/machine-learning" {
		t.Errorf("subjectURL = %q, want /subjects/machine-learning", got)
	}
}
