package app_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gabrielassisxyz/norte/server/internal/app"
	"github.com/gabrielassisxyz/norte/server/internal/core"
	"github.com/gabrielassisxyz/norte/server/internal/core/clocktest"
	"github.com/gabrielassisxyz/norte/server/internal/core/llmtest"
	_ "github.com/gabrielassisxyz/norte/server/internal/library"
	_ "github.com/gabrielassisxyz/norte/server/internal/notes"
)

// The deterministic instant and poll step the vertical test runs on, so an
// ordering assertion never depends on how fast the machine is.
var norteVerticalInstant = time.Date(2026, 10, 8, 9, 0, 0, 0, time.UTC)

const norteVerticalWorkerStep = time.Second

// norteVerticalHarness is a whole Norte, assembled the way serve assembles
// one: the real router over a real database in a directory of the test's own,
// with every enabled module's migrations applied, its job handlers
// registered, and its text provider wired.
//
// It exists because no other test here boots the whole thing. The library's
// harness has the library only, the notes harness has no LLM, and the
// integration router has no database at all -- so the one path this product
// is for, a link becoming a highlight and a question under a subject, was
// never walked in one piece by anything.
//
// The module adapters are deliberately not started. Of the two, only notes
// installs anything, and what it installs is the re-anchoring that follows a
// *second* extraction; this walk highlights after the first one has finished,
// so starting them would add two goroutines to shut down and prove nothing
// this test is about.
type norteVerticalHarness struct {
	t        *testing.T
	database *core.Database
	clock    *clocktest.Clock
	llm      *llmtest.Server
	deps     app.Deps
	router   http.Handler
}

type norteVerticalOptions struct {
	// Classify is false for the negative control: with no LLM configured the
	// library enqueues no classification, so nothing may be suggested.
	Classify bool
}

func newNorteVerticalHarness(t *testing.T, options norteVerticalOptions) *norteVerticalHarness {
	t.Helper()
	clock := clocktest.New(norteVerticalInstant)
	dataDir := t.TempDir()
	database, err := core.OpenDatabase(context.Background(), dataDir)
	if err != nil {
		t.Fatalf("opening a database in %s: %v", dataDir, err)
	}
	t.Cleanup(func() {
		if err := database.Close(context.Background()); err != nil {
			t.Errorf("closing the database: %v", err)
		}
	})

	stub := llmtest.New(`{"suggestions":[]}`)
	t.Cleanup(stub.Close)
	llmURL := ""
	if options.Classify {
		llmURL = stub.URL()
	}
	cfg, _, err := app.Load(app.LoadOptions{
		LookupEnv: func(name string) (string, bool) {
			switch name {
			case "NORTE_MODULES":
				return "library,notes", true
			case "NORTE_LLM_URL":
				return llmURL, llmURL != ""
			case "NORTE_LLM_MODEL":
				return "a-test-model", true
			case "NORTE_LLM_KEY":
				return "sk-vertical-test", true
			}
			return "", false
		},
		Home: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	modules, err := app.ResolveNorteModules(cfg.Modules)
	if err != nil {
		t.Fatalf("ResolveNorteModules: %v", err)
	}
	if _, err := core.MigrateCore(context.Background(), database.Writer()); err != nil {
		t.Fatalf("applying the core migrations: %v", err)
	}
	if _, err := app.MigrateNorteModules(context.Background(), database.Writer(), modules); err != nil {
		t.Fatalf("applying the module migrations: %v", err)
	}

	queue := core.NewJobs(database.Writer(), clock, nil)
	texts := core.NewTexts(database.Reader(), nil)
	deps := app.Deps{
		Database:      database,
		Jobs:          queue,
		Files:         core.NewFiles(dataDir, database.Writer(), clock),
		Clock:         clock,
		Events:        core.NewEvents(),
		Texts:         texts,
		Logger:        slog.New(slog.NewJSONHandler(io.Discard, nil)),
		FetchMaxBytes: cfg.FetchMaxBytes,
		LLMURL:        cfg.LLMURL,
		LLM:           core.NewLLM(cfg.LLMURL, cfg.LLMModel, cfg.LLMKey),
		LinkCandidates: core.NewLinkCandidates(database,
			app.NorteFocusProviders(modules)),
		Focus: core.NewFocusAPI(core.NewSubjects(database, clock),
			app.NorteFocusProviders(modules)),
	}
	texts.SetProviders(app.NorteTextProviders(modules, deps))
	app.RegisterNorteJobHandlers(queue, modules, deps)

	router, err := app.NewRouter(app.RouterOptions{
		Config: cfg,
		Logger: deps.Logger,
		Assets: fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>Norte</title>")}},
		// The frontend is a placeholder here: this test is about the API the
		// frontend calls, and embedding the real one would make the whole
		// suite wait for a vite build.
		Modules:    modules,
		ModuleDeps: deps,
	})
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}
	return &norteVerticalHarness{
		t: t, database: database, clock: clock, llm: stub, deps: deps, router: router,
	}
}

// request sends one JSON request at the router with a Host the allowlist
// accepts. A nil body sends no body at all, which is what a GET is.
func (h *norteVerticalHarness) request(method, path string, body any) *httptest.ResponseRecorder {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.t.Fatalf("encoding the %s %s body: %v", method, path, err)
		}
		reader = strings.NewReader(string(encoded))
	}
	request := httptest.NewRequest(method, path, reader)
	request.Host = "localhost:8080"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	h.router.ServeHTTP(recorder, request)
	return recorder
}

// decode reads one answer, failing the test with the body when the status is
// not the expected one -- which is what turns a wrong field name into a
// readable failure instead of a zero-valued struct.
func norteVerticalDecode[T any](t *testing.T, recorder *httptest.ResponseRecorder, want int) T {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status %d, want %d: %s", recorder.Code, want, recorder.Body.String())
	}
	var decoded T
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decoding %s: %v", recorder.Body.String(), err)
	}
	return decoded
}

// drainJobs runs one worker until the queue is empty, moving the manual clock
// so the poll comes round. The clock is what makes progress; the short real
// pause only yields the processor to the worker's goroutine.
func (h *norteVerticalHarness) drainJobs() {
	h.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	worker := core.NewJobsWorker(h.deps.Jobs, h.clock, h.deps.Logger, core.NewID())
	done := make(chan struct{})
	go func() {
		_ = worker.Run(ctx)
		close(done)
	}()
	deadline := time.Now().Add(30 * time.Second)
	for h.outstandingJobs() > 0 {
		if time.Now().After(deadline) {
			h.t.Fatalf("the worker never drained the queue: %d jobs left", h.outstandingJobs())
		}
		h.clock.Advance(norteVerticalWorkerStep)
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	<-done
}

func (h *norteVerticalHarness) outstandingJobs() int {
	h.t.Helper()
	var count int
	if err := h.database.Reader().QueryRow(
		`SELECT COUNT(*) FROM core_jobs WHERE status IN ('queued', 'running')`).Scan(&count); err != nil {
		h.t.Fatalf("counting the outstanding jobs: %v", err)
	}
	return count
}

func (h *norteVerticalHarness) extractStatus(itemID string) string {
	h.t.Helper()
	var status string
	if err := h.database.Reader().QueryRow(
		`SELECT extract_status FROM library_items WHERE id = ?`, itemID).Scan(&status); err != nil {
		h.t.Fatalf("reading the extract status of %s: %v", itemID, err)
	}
	return status
}

/* -------------------------------------------------- the wire shapes read */

type norteVerticalSaved struct {
	ID string `json:"id"`
}

type norteVerticalSubject struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Focus bool   `json:"focus"`
}

type norteVerticalRegistryItem struct {
	ID     string `json:"id"`
	Module string `json:"module"`
	Type   string `json:"type"`
	Title  string `json:"title"`
}

type norteVerticalLink struct {
	ID         string                    `json:"id"`
	Kind       string                    `json:"kind"`
	Source     string                    `json:"source"`
	Status     string                    `json:"status"`
	Confidence *float64                  `json:"confidence"`
	Src        norteVerticalRegistryItem `json:"src"`
	Dst        norteVerticalRegistryItem `json:"dst"`
}

type norteVerticalLinkList struct {
	Items []norteVerticalLink `json:"items"`
}

type norteVerticalHighlight struct {
	ID     string `json:"id"`
	Exact  string `json:"exact"`
	Status string `json:"status"`
}

type norteVerticalQuestion struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

type norteVerticalItemSummary struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type norteVerticalItemList struct {
	Items []norteVerticalItemSummary `json:"items"`
}

type norteVerticalSearchHit struct {
	ID     string  `json:"id"`
	Module string  `json:"module"`
	Type   string  `json:"type"`
	Title  string  `json:"title"`
	Path   string  `json:"path"`
	Score  float64 `json:"score"`
}

type norteVerticalSearchResults struct {
	Entries []norteVerticalSearchHit `json:"entries"`
}

/* ------------------------------------------------------------ the fixture */

// norteVerticalPageURL is deliberately a public host. The extraction refuses
// loopback and private addresses on purpose, so a test cannot stand a page up
// on an httptest server and have the server fetch it -- the page travels as a
// snapshot in the save, which is exactly what the browser extension does.
const norteVerticalPageURL = "https://essays.example/ensaios/memoria-de-trabalho"

// norteVerticalPhrase is the sentence the highlight anchors to. It appears
// once in the fixture, which is what makes the anchor unambiguous.
const norteVerticalPhrase = "A memória de trabalho segura poucos itens por vez."

// norteVerticalBodyWord appears in the article's text and nowhere else -- not
// in the title, not in a heading, not in any other fixture. Searching for it
// is therefore a question only the extracted text can answer.
const norteVerticalBodyWord = "zarabatana"

const norteVerticalPage = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Memória de trabalho e o limite do que cabe</title>
    <meta name="author" content="Uma autora" />
  </head>
  <body>
    <nav><a href="/">Início</a> <a href="/ensaios">Ensaios</a></nav>
    <article>
      <h1>Memória de trabalho e o limite do que cabe</h1>
      <p>A memória de trabalho segura poucos itens por vez. Esse limite não é
      um defeito de atenção: é o tamanho da bancada onde o pensamento acontece,
      e tudo o que se quer pensar junto precisa caber nela ao mesmo tempo.</p>
      <h2>O que o limite obriga</h2>
      <p>Quando a bancada enche, a saída é agrupar. Um conjunto de detalhes que
      já foi entendido vira uma peça só, e a peça ocupa um lugar em vez de
      quinze. É por isso que quem conhece um assunto parece ter mais espaço:
      não tem, apenas carrega peças maiores.</p>
      <p>O mesmo vale para o que se lê. Uma leitura que não foi agrupada em
      nada continua ocupando a bancada inteira na próxima vez, como uma
      zarabatana guardada atravessada numa gaveta rasa.</p>
      <h2>O que isso muda na prática</h2>
      <p>Ler devagar não resolve nada por si. O que resolve é terminar a
      leitura em alguma coisa que sobreviva ao dia: uma passagem marcada, uma
      pergunta que ficou, uma nota curta ligada ao assunto de que ela trata.</p>
    </article>
    <footer><p>Publicado em 2026.</p></footer>
  </body>
</html>`
