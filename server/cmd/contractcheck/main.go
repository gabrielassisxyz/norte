// Command contractcheck enforces the two rules about api/openapi/<module>.yaml
// that no generator checks for us.
//
//	contractcheck [<directory>]      default: api/openapi next to this module
//
// The first rule is the prefix: a file may only declare paths under
// /api/<its own name>/, so a module implements its own interface and nothing
// else, and a disabled module is simply a prefix nobody mounts. The core file
// carries two exceptions, /api/config and /api/health, because a client calls
// those before it knows which modules exist.
//
// The second is that every object schema pins additionalProperties to false.
// Without it the generated types still compile and the validator still passes,
// but a request carrying a field the contract never named is accepted and
// silently dropped -- which is exactly the class of mismatch between screen and
// server this contract exists to make impossible.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// coreModule is the file that holds the always-on part of the API.
const coreModule = "core"

// coreOnlyPaths are the paths a client calls before it knows which modules
// exist. They live in the core file and nowhere else.
var coreOnlyPaths = map[string]bool{"/api/config": true, "/api/health": true}

// documentationKeys hold arbitrary author-supplied data rather than schemas, so
// the walk does not descend into them: an example of a request body can legally
// contain a key called "type" with the value "object".
var documentationKeys = map[string]bool{"example": true, "examples": true, "default": true}

func main() {
	directory := defaultDirectory()
	if len(os.Args) > 1 {
		directory = os.Args[1]
	}

	problems, err := checkDirectory(directory)
	if err != nil {
		fmt.Fprintf(os.Stderr, "contractcheck: %v\n", err)
		os.Exit(1)
	}
	if len(problems) > 0 {
		for _, problem := range problems {
			fmt.Fprintf(os.Stderr, "contractcheck: %s\n", problem)
		}
		os.Exit(1)
	}
	fmt.Printf("contractcheck: every contract in %s keeps to its own prefix and names every field it accepts\n", directory)
}

// defaultDirectory is api/openapi relative to the working directory, then one
// level up, so the check runs both from the repository root and from server/.
func defaultDirectory() string {
	for _, candidate := range []string{"api/openapi", "../api/openapi"} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return "api/openapi"
}

func checkDirectory(directory string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(directory, "*.yaml"))
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", directory, err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no contract files in %s; a check that reads nothing proves nothing", directory)
	}
	sort.Strings(files)

	var problems []string
	for _, file := range files {
		document, err := readDocument(file)
		if err != nil {
			return nil, err
		}
		module := strings.TrimSuffix(filepath.Base(file), ".yaml")
		problems = append(problems, prefixProblems(file, module, document)...)
		problems = append(problems, openObjectProblems(file, document, "")...)
	}
	return problems, nil
}

func readDocument(file string) (map[string]any, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", file, err)
	}
	var document map[string]any
	if err := yaml.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", file, err)
	}
	return document, nil
}

// prefixProblems reports every path the file is not allowed to declare.
func prefixProblems(file, module string, document map[string]any) []string {
	paths, ok := document["paths"].(map[string]any)
	if !ok || len(paths) == 0 {
		return []string{fmt.Sprintf("%s declares no paths, so the module it names has no interface", file)}
	}

	prefix := "/api/" + module + "/"
	var problems []string
	for _, path := range sortedKeys(paths) {
		if strings.HasPrefix(path, prefix) {
			continue
		}
		if module == coreModule && coreOnlyPaths[path] {
			continue
		}
		problems = append(problems, fmt.Sprintf(
			"%s declares the path %s, which is outside its prefix %s%s",
			file, path, prefix, allowanceNote(module)))
	}
	return problems
}

func allowanceNote(module string) string {
	if module == coreModule {
		return " (the core file also allows " + strings.Join(sortedKeys(coreOnlyPaths), " and ") + ")"
	}
	return " (only the core file may declare " + strings.Join(sortedKeys(coreOnlyPaths), " or ") + ")"
}

// openObjectProblems reports every object schema that would accept a field the
// contract never named. The walk is over the whole document rather than over
// components/schemas alone, because a schema written inline in a request body
// is just as much part of the contract.
func openObjectProblems(file string, node any, where string) []string {
	switch typed := node.(type) {
	case map[string]any:
		var problems []string
		if typed["type"] == "object" {
			if value, ok := typed["additionalProperties"]; !ok || value != false {
				problems = append(problems, fmt.Sprintf(
					"%s: the object schema at %s does not set additionalProperties: false, "+
						"so it accepts fields the contract never named", file, schemaLocation(where)))
			}
		}
		for _, key := range sortedKeys(typed) {
			if documentationKeys[key] {
				continue
			}
			problems = append(problems, openObjectProblems(file, typed[key], join(where, key))...)
		}
		return problems
	case []any:
		var problems []string
		for index, item := range typed {
			problems = append(problems, openObjectProblems(file, item, fmt.Sprintf("%s[%d]", where, index))...)
		}
		return problems
	default:
		return nil
	}
}

func schemaLocation(where string) string {
	if where == "" {
		return "the document root"
	}
	return where
}

func join(where, key string) string {
	if where == "" {
		return key
	}
	return where + "." + key
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
