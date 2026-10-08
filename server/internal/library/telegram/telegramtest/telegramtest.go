// Package telegramtest is the Telegram the adapter's tests talk to: an
// httptest server speaking getUpdates and sendMessage over scripted updates,
// so that no test reaches Telegram and no test needs a token that works.
package telegramtest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"time"
)

// idlePoll is how long the fake holds a poll that has nothing to offer.
//
// Telegram holds it for the timeout the client asked for, thirty seconds. The
// fake cannot: httptest's Close waits for the requests still in flight, so a
// test that ends while a poll is parked would wait out that timeout before it
// could report anything. A short hold makes an idle adapter re-poll instead,
// which is the same behaviour at a different rate.
const idlePoll = 150 * time.Millisecond

// Update is one scripted message, flattened to the fields the adapter reads.
type Update struct {
	UpdateID  int64
	ChatID    int64
	MessageID int64
	Text      string
}

// Send is one sendMessage the fake received.
type Send struct {
	ChatID int64
	Text   string
}

// Server is the fake. Updates are kept for the life of it and offered to every
// poll whose offset reaches them, which is what lets a test restart the poller
// and see what a real Telegram would re-offer.
type Server struct {
	mu        sync.Mutex
	updates   []Update
	sends     []Send
	failSends int
	arrived   chan struct{}
	sent      chan struct{}

	server *httptest.Server
}

// New starts the fake. The caller closes it.
func New() *Server {
	fake := &Server{
		arrived: make(chan struct{}),
		sent:    make(chan struct{}, 1),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", fake.route)
	fake.server = httptest.NewServer(mux)
	return fake
}

// URL is the API base the adapter's Settings point at.
func (s *Server) URL() string { return s.server.URL }

// Close stops the fake.
func (s *Server) Close() { s.server.Close() }

// Deliver scripts one update and wakes whatever poll is parked.
func (s *Server) Deliver(update Update) {
	s.mu.Lock()
	s.updates = append(s.updates, update)
	waiting := s.arrived
	s.arrived = make(chan struct{})
	s.mu.Unlock()
	close(waiting)
}

// Sends reports every reply the fake received, in order.
func (s *Server) Sends() []Send {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Send(nil), s.sends...)
}

// FailSends makes the next count sendMessage calls answer 500. The send is
// still recorded, because a reply Telegram accepted and then failed to
// acknowledge is indistinguishable from this one.
func (s *Server) FailSends(count int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failSends = count
}

// WaitForSends waits until at least count replies have arrived, and reports
// whether they did before the deadline.
func (s *Server) WaitForSends(count int, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for {
		s.mu.Lock()
		have := len(s.sends)
		s.mu.Unlock()
		if have >= count {
			return true
		}
		select {
		case <-s.sent:
		case <-deadline:
			return false
		}
	}
}

// route dispatches on the method name after the bot token, which is the shape
// of every Bot API path.
func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	method := r.URL.Path
	if i := strings.LastIndexByte(method, '/'); i >= 0 {
		method = method[i+1:]
	}
	switch method {
	case "getUpdates":
		s.getUpdates(w, r)
	case "sendMessage":
		s.sendMessage(w, r)
	default:
		writeEnvelope(w, http.StatusNotFound, `{"ok":false,"description":"unknown method"}`)
	}
}

// getUpdates answers the scripted updates from the requested offset on, and
// holds the request while there are none.
func (s *Server) getUpdates(w http.ResponseWriter, r *http.Request) {
	offset, _ := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	deadline := time.After(idlePoll)
	for {
		s.mu.Lock()
		pending := make([]Update, 0, len(s.updates))
		for _, update := range s.updates {
			if update.UpdateID >= offset {
				pending = append(pending, update)
			}
		}
		waiting := s.arrived
		s.mu.Unlock()
		if len(pending) > 0 {
			writeUpdates(w, pending)
			return
		}
		select {
		case <-waiting:
		case <-r.Context().Done():
			writeUpdates(w, nil)
			return
		case <-deadline:
			writeUpdates(w, nil)
			return
		}
	}
}

func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ChatID int64  `json:"chat_id"`
		Text   string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeEnvelope(w, http.StatusBadRequest, `{"ok":false,"description":"bad request body"}`)
		return
	}
	s.mu.Lock()
	s.sends = append(s.sends, Send{ChatID: body.ChatID, Text: body.Text})
	fail := s.failSends > 0
	if fail {
		s.failSends--
	}
	s.mu.Unlock()
	select {
	case s.sent <- struct{}{}:
	default:
	}
	if fail {
		writeEnvelope(w, http.StatusInternalServerError,
			`{"ok":false,"description":"Bad Gateway: the fake was told to fail this send"}`)
		return
	}
	writeEnvelope(w, http.StatusOK, `{"ok":true,"result":{"message_id":1}}`)
}

func writeUpdates(w http.ResponseWriter, updates []Update) {
	result := make([]map[string]any, 0, len(updates))
	for _, update := range updates {
		result = append(result, map[string]any{
			"update_id": update.UpdateID,
			"message": map[string]any{
				"message_id": update.MessageID,
				"chat":       map[string]any{"id": update.ChatID},
				"text":       update.Text,
			},
		})
	}
	encoded, err := json.Marshal(map[string]any{"ok": true, "result": result})
	if err != nil {
		writeEnvelope(w, http.StatusInternalServerError, `{"ok":false,"description":"fake could not encode"}`)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(encoded)
}

func writeEnvelope(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
