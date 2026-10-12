package library

import (
	"context"
	"strings"
	"testing"
)

// TestLibraryRulesCLIEndToEnd is the done-when path through the command line:
// set a rule, list it, save a URL it places in the stash by rule, remove it,
// and the suggestions with their dismissal.
func TestLibraryRulesCLIEndToEnd(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)

	setOut, err := runLibraryCLI(t, dataDir, "rules", "set", "github.com", "stash")
	if err != nil {
		t.Fatalf("norte rules set: %v\n%s", err, setOut)
	}
	if strings.TrimSpace(setOut) != "github.com\tstash" {
		t.Errorf("norte rules set printed %q, want github.com and stash tab-separated", setOut)
	}

	listOut, err := runLibraryCLI(t, dataDir, "rules", "list")
	if err != nil {
		t.Fatalf("norte rules list: %v\n%s", err, listOut)
	}
	if strings.TrimSpace(listOut) != "github.com\tstash" {
		t.Errorf("norte rules list printed %q, want the one stored rule", listOut)
	}

	saveOut, err := runLibraryCLI(t, dataDir, "save", "https://github.com/example/repo")
	if err != nil {
		t.Fatalf("norte save: %v\n%s", err, saveOut)
	}
	id := strings.TrimSpace(saveOut)
	if id == "" {
		t.Fatalf("norte save printed no id:\n%s", saveOut)
	}

	clock := libraryTestClock()
	database := openLibraryDBAt(t, dataDir, clock)
	service := newLibraryTestService(t, database, dataDir, clock)
	row, err := service.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("reading the saved item: %v", err)
	}
	if row.Location != "stash" || row.LocationSource != "rule" {
		t.Errorf("the item is in %q by %q, want the stash by rule", row.Location, row.LocationSource)
	}

	rmOut, err := runLibraryCLI(t, dataDir, "rules", "rm", "github.com")
	if err != nil {
		t.Fatalf("norte rules rm: %v\n%s", err, rmOut)
	}
	if strings.TrimSpace(rmOut) != "" {
		t.Errorf("norte rules rm printed %q, want nothing", rmOut)
	}
	if listOut, err := runLibraryCLI(t, dataDir, "rules", "list"); err != nil {
		t.Fatalf("norte rules list after rm: %v\n%s", err, listOut)
	} else if strings.TrimSpace(listOut) != "" {
		t.Errorf("the list after rm is %q, want empty", listOut)
	}

	// Removing again refuses with the service's sentence.
	if out, err := runLibraryCLI(t, dataDir, "rules", "rm", "github.com"); err == nil {
		t.Errorf("a second rm succeeded, want the missing-rule refusal (%q)", out)
	} else if !strings.Contains(err.Error(), "no domain rule") {
		t.Errorf("the second rm says %q, want the missing-rule sentence", err)
	}

	// Three hand moves suggest through the command line: the saves arrive by
	// CLI and the moves are the person's own patches on the same directory.
	for _, page := range []string{"one", "two", "three"} {
		out, err := runLibraryCLI(t, dataDir, "save", "https://suggest.example/"+page)
		if err != nil {
			t.Fatalf("norte save suggest: %v\n%s", err, out)
		}
		place := "stash"
		if _, err := service.Patch(context.Background(), strings.TrimSpace(out), PatchInput{Location: &place}); err != nil {
			t.Fatalf("placing the suggest item: %v", err)
		}
	}
	suggestOut, err := runLibraryCLI(t, dataDir, "rules", "suggestions")
	if err != nil {
		t.Fatalf("norte rules suggestions: %v\n%s", err, suggestOut)
	}
	if strings.TrimSpace(suggestOut) != "suggest.example\tstash\t3" {
		t.Errorf("the suggestions print %q, want suggest.example in the stash with 3 moves", suggestOut)
	}

	if out, err := runLibraryCLI(t, dataDir, "rules", "dismiss", "suggest.example"); err != nil {
		t.Fatalf("norte rules dismiss: %v\n%s", err, out)
	}
	if suggestOut, err := runLibraryCLI(t, dataDir, "rules", "suggestions"); err != nil {
		t.Fatalf("norte rules suggestions after dismiss: %v\n%s", err, suggestOut)
	} else if strings.TrimSpace(suggestOut) != "" {
		t.Errorf("the suggestions after dismiss print %q, want empty", suggestOut)
	}
}

// TestLibraryRulesCLIRefusalsAreBareSentences: every refusal prints the
// service's message the way norte subjects does, rather than an error chain.
func TestLibraryRulesCLIRefusalsAreBareSentences(t *testing.T) {
	dataDir := libraryFreshCLIDir(t)

	if out, err := runLibraryCLI(t, dataDir, "rules", "set", "localhost", "stash"); err == nil {
		t.Errorf("setting localhost succeeded, want a refusal (%q)", out)
	} else if !strings.Contains(err.Error(), "invalid domain") {
		t.Errorf("setting localhost says %q, want the invalid-domain sentence", err)
	}

	if out, err := runLibraryCLI(t, dataDir, "rules", "set", "example.org", "up_next"); err == nil {
		t.Errorf("setting up_next succeeded, want a refusal (%q)", out)
	} else if !strings.Contains(err.Error(), "unknown location") {
		t.Errorf("setting up_next says %q, want the unknown-location sentence", err)
	}
}

// TestLibraryRulesCommandsComeFromTheModule: the five commands are registered
// only when the library module is enabled, through LibraryModule.Commands().
func TestLibraryRulesCommandsComeFromTheModule(t *testing.T) {
	commands := (&LibraryModule{}).Commands()
	uses := []string{}
	for _, cmd := range commands {
		uses = append(uses, cmd.Use)
	}
	foundRules := false
	found := map[string]bool{}
	for _, cmd := range commands {
		if cmd.Name() != "rules" {
			continue
		}
		foundRules = true
		for _, sub := range cmd.Commands() {
			name := sub.Name()
			found[name] = true
		}
	}
	if !foundRules {
		t.Fatalf("the module registers %v, want a rules command among them", uses)
	}
	for _, want := range []string{"list", "set", "rm", "suggestions", "dismiss"} {
		if !found[want] {
			t.Errorf("norte rules registers %v, want %s among them", found, want)
		}
	}
}
