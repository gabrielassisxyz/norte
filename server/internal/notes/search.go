package notes

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/gabrielassisxyz/norte/server/internal/core"
)

// The routes that open each kind of writing. An annotation and a question are
// read on the tab that lists their kind, which is where a hit sends the
// person. An item's note has no tab listing it: it is read on the reader's
// "Nota" tab of its item, so its hit opens that item's reader with the note
// asked for.
const (
	notesAnnotationsPath = "/notas?tab=anotacoes"
	notesQuestionsPath   = "/notas?tab=perguntas"
)

// notesItemNotePath is the reader route that shows an item's note: the item,
// with the reader's note section asked for.
func notesItemNotePath(itemID string) string {
	return "/library/" + itemID + "?notes=note"
}

// notesSearchTitleRunes is how much of a note's text becomes the hit's title.
// A note is a paragraph, not a name, so the title is an excerpt and the rest
// is read on the tab the hit opens.
const notesSearchTitleRunes = 80

// notesSearchEntries is the module's answer for GET /api/core/search: the
// person's own writing -- the margin annotations, the one note an item
// carries, and the questions with their answers.
//
// A highlight is deliberately not searched. A highlight is a passage copied
// out of an article, so indexing it would index the library's text a second
// time and make one article answer the same query twice, once as itself and
// once as every passage marked in it.
//
// The match is every word of the query, compared through the core's slug rule
// so that "memoria" finds a note that says "memória". That comparison cannot
// be pushed into the statement: SQLite has no unaccenting function and this
// module has no full-text index to borrow one from, so the rows are read and
// matched here. It is a scan of the three tables per query, which is the
// trade this module can afford -- one person's annotations, notes and
// questions -- and the move when it stops being affordable is an FTS5 table
// with triggers, the way the library has one.
//
// The ranking is how many of a note's words are words of the query, which is
// the only relevance signal available without that index.
func notesSearchEntries(ctx context.Context, database *core.Database, query string, limit int) ([]core.SearchEntry, error) {
	if database == nil || limit <= 0 {
		return []core.SearchEntry{}, nil
	}
	words := notesSearchWords(query)
	if len(words) == 0 {
		return []core.SearchEntry{}, nil
	}
	statement := "SELECT candidate.id, candidate.kind, candidate.item_id, candidate.text," +
		" COALESCE(core_items.title, '') AS source_title" +
		" FROM (" + notesSearchCandidates + ") AS candidate" +
		" LEFT JOIN core_items ON core_items.id = candidate.item_id"
	rows, err := database.Reader().QueryContext(ctx, statement)
	if err != nil {
		return nil, fmt.Errorf("searching the notes: %w", err)
	}
	defer rows.Close()
	type notesSearchHit struct {
		entry core.SearchEntry
		count float64
	}
	hits := []notesSearchHit{}
	for rows.Next() {
		var id, kind, itemID, text string
		var sourceTitle sql.NullString
		if err := rows.Scan(&id, &kind, &itemID, &text, &sourceTitle); err != nil {
			return nil, fmt.Errorf("scanning a note search row: %w", err)
		}
		count, matched := notesSearchRelevance(text, words)
		if !matched {
			continue
		}
		hits = append(hits, notesSearchHit{
			entry: core.SearchEntry{
				ID:       id,
				Module:   ModuleName,
				Type:     kind,
				Title:    notesSearchExcerpt(text),
				Subtitle: sourceTitle.String,
				Path:     notesSearchPath(kind, itemID),
			},
			count: count,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("searching the notes: %w", err)
	}
	// Sorted here, before the cap, so the hits this module gives up are the
	// weakest ones rather than whichever the scan reached last. The id breaks
	// the tie, which is what keeps one query's answer the same twice running.
	sort.Slice(hits, func(i, j int) bool {
		if hits[i].count != hits[j].count {
			return hits[i].count > hits[j].count
		}
		return hits[i].entry.ID < hits[j].entry.ID
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	counts := make([]float64, len(hits))
	for i, found := range hits {
		counts[i] = found.count
	}
	scores := core.NormalizeSearchScores(counts, false)
	entries := make([]core.SearchEntry, 0, len(hits))
	for i, found := range hits {
		found.entry.Score = scores[i]
		entries = append(entries, found.entry)
	}
	return entries, nil
}

// notesSearchCandidates is every piece of the person's own writing, as one
// relation of (id, kind, item_id, text).
//
// A question carries its answer in the searched text, because the pair is one
// thought: the answer is where the person wrote what they concluded, and a
// search that read only the question would miss it.
const notesSearchCandidates = `
    SELECT notes_annotations.id AS id, 'annotation' AS kind,
           notes_annotations.item_id AS item_id, notes_annotations.text AS text
    FROM notes_annotations
    UNION ALL
    SELECT notes_notes.id, 'note', notes_notes.item_id, notes_notes.text
    FROM notes_notes
    UNION ALL
    SELECT notes_questions.id, 'question', notes_questions.item_id,
           notes_questions.text || ' ' || COALESCE(notes_questions.answer, '')
    FROM notes_questions`

// notesSearchPath is where a hit of this kind opens. An annotation and a
// question open on the tab that lists them; an item's note opens in its
// item's reader, where the note is read.
func notesSearchPath(kind, itemID string) string {
	switch kind {
	case "question":
		return notesQuestionsPath
	case "note":
		return notesItemNotePath(itemID)
	default:
		return notesAnnotationsPath
	}
}

// notesSearchExcerpt renders a note's text as a one-line title: the newlines
// collapsed, and cut on a rune boundary so a multi-byte character is never
// split in half.
func notesSearchExcerpt(text string) string {
	collapsed := strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(collapsed) <= notesSearchTitleRunes {
		return collapsed
	}
	runes := []rune(collapsed)
	return strings.TrimRight(string(runes[:notesSearchTitleRunes]), " ") + "…"
}

// notesSearchWords splits the query into the comparable words the match and
// the ranking both use, through the core's slug rule: lowercase, accents
// stripped, and everything that is not a letter or a digit treated as a
// separator. A query of pure punctuation yields none, which is how a note
// search answers nothing rather than everything.
func notesSearchWords(query string) []string {
	slug := core.Slugify(query)
	if slug == "" {
		return nil
	}
	return strings.Split(slug, "-")
}

// notesSearchRelevance reports how many of a note's words are words of the
// query, and whether every word of the query appeared at all.
//
// The second result is the match rule and the first is only the ranking:
// every word must be there, the same AND the library's full-text query uses,
// because a note matching one word of three is not what was asked for. A note
// that keeps coming back to the thing asked about then counts higher than one
// mentioning it once, which is the only relevance signal there is here.
func notesSearchRelevance(text string, words []string) (float64, bool) {
	if len(words) == 0 {
		return 0, false
	}
	present := make(map[string]int, len(words))
	for _, token := range strings.Split(core.Slugify(text), "-") {
		if token != "" {
			present[token]++
		}
	}
	count := 0
	for _, word := range words {
		found := present[word]
		if found == 0 {
			return 0, false
		}
		count += found
	}
	return float64(count), true
}
