package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// redactedToken is what the token is replaced with in anything that can be
// logged.
const redactedToken = "<token>"

// clientReadLimit bounds what one API answer may be. Telegram's answers are
// small; a body larger than this is a proxy or a captive portal, and reading it
// whole would be the only unbounded read in the adapter.
const clientReadLimit = 1 << 20

// updatesBatchLimit caps how many updates one getUpdates answer carries. The
// answer is read through clientReadLimit, and a batch larger than that is cut
// mid-JSON, fails to parse and is fetched again unchanged forever; a small
// batch keeps the answer far below the cap.
const updatesBatchLimit = 20

// Client is the slice of the Telegram Bot API this adapter uses: long-polled
// updates in, one message out.
//
// Every error it returns is scrubbed of the token. That is not belt and braces:
// the token is a path segment of every request, so the standard library's own
// *url.Error carries it, and an unscrubbed wrap would put the bot's credential
// in a log line the first time Telegram is unreachable.
type Client struct {
	token  string
	base   string
	client *http.Client
}

// NewClient returns the client settings describe.
func NewClient(settings Settings) *Client {
	base := settings.APIBase
	if base == "" {
		base = DefaultAPIBase
	}
	return &Client{
		token: settings.Token,
		base:  strings.TrimRight(base, "/"),
		// The timeout has to outlast the long poll itself, or every idle poll
		// would come back as a failure.
		client: &http.Client{Timeout: pollTimeout + 15*time.Second},
	}
}

// Update is one entry of getUpdates. Message is nil for everything this
// adapter does not read -- an edit, a reaction, a channel post.
type Update struct {
	UpdateID int64    `json:"update_id"`
	Message  *Message `json:"message"`
}

// Message is the part of a Telegram message the adapter looks at.
type Message struct {
	MessageID int64  `json:"message_id"`
	Chat      Chat   `json:"chat"`
	Text      string `json:"text"`
	// Caption is where the text of a photo, video or document lives; such a
	// message has no Text.
	Caption string `json:"caption"`
}

// Chat identifies where a message came from.
type Chat struct {
	ID int64 `json:"id"`
}

// apiEnvelope is the shape every Bot API answer carries.
type apiEnvelope struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"`
}

// GetUpdates long-polls for the updates from offset on. Telegram holds the
// request open until something arrives or timeout passes, and answers an empty
// list in the second case.
func (c *Client) GetUpdates(ctx context.Context, offset int64, timeout time.Duration) ([]Update, error) {
	query := url.Values{}
	query.Set("offset", strconv.FormatInt(offset, 10))
	query.Set("limit", strconv.Itoa(updatesBatchLimit))
	query.Set("timeout", strconv.Itoa(int(timeout.Seconds())))
	raw, err := c.call(ctx, http.MethodGet, "getUpdates?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	var updates []Update
	if err := json.Unmarshal(raw, &updates); err != nil {
		return nil, fmt.Errorf("reading the Telegram updates: %w", err)
	}
	return updates, nil
}

// SendMessage posts one reply. Link previews are off: the reply carries the
// title already, and an unfurled preview of the article underneath it is noise.
func (c *Client) SendMessage(ctx context.Context, chatID int64, text string) error {
	body, err := json.Marshal(map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"disable_web_page_preview": true,
	})
	if err != nil {
		return fmt.Errorf("encoding the Telegram reply: %w", err)
	}
	_, err = c.call(ctx, http.MethodPost, "sendMessage", body)
	return err
}

// call runs one API method and returns its result. The method name is the only
// part of the address that reaches an error message.
func (c *Client) call(ctx context.Context, method, endpoint string, body []byte) (json.RawMessage, error) {
	name := endpoint
	if i := strings.IndexByte(name, '?'); i >= 0 {
		name = name[:i]
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.base+"/bot"+c.token+"/"+endpoint, reader)
	if err != nil {
		return nil, fmt.Errorf("building the Telegram %s request: %w", name, c.scrub(err))
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("calling Telegram %s: %w", name, c.scrub(err))
	}
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(io.LimitReader(response.Body, clientReadLimit))
	if err != nil {
		return nil, fmt.Errorf("reading the Telegram %s answer: %w", name, c.scrub(err))
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("Telegram %s answered %d with %d bytes that are not an API answer",
			name, response.StatusCode, len(payload))
	}
	if !envelope.OK {
		return nil, fmt.Errorf("Telegram %s answered %d: %s",
			name, response.StatusCode, c.scrubText(envelope.Description))
	}
	return envelope.Result, nil
}

// scrub replaces the token in an error's message, and returns a plain error so
// nothing downstream can reach the original through Unwrap.
func (c *Client) scrub(err error) error {
	if err == nil {
		return nil
	}
	return errors.New(c.scrubText(err.Error()))
}

// scrubText replaces the token in text Telegram or the network put in front of
// us. A description that echoes the request path is exactly how a bot token
// ends up in a log.
func (c *Client) scrubText(text string) string {
	if c.token == "" {
		return text
	}
	return strings.ReplaceAll(text, c.token, redactedToken)
}
