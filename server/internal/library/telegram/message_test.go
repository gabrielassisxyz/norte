package telegram

import (
	"strings"
	"testing"
)

// TestFirstLinkReadsTheLinkAndTheNote walks the shapes a person actually sends
// from a phone: the bare link, the link with a thought before it, after it, or
// wrapped around it, two links in one message, and a message that is only
// text.
//
// The note is the point of the table. "Why I saved this" is the field the
// library screen shows next to the item, so what gets stripped and what gets
// kept is a product decision, not an implementation detail.
func TestFirstLinkReadsTheLinkAndTheNote(t *testing.T) {
	cases := []struct {
		name string
		text string
		link string
		why  string
		ok   bool
	}{
		{
			name: "the bare link leaves no note",
			text: "https://ortaessays.example/essays/notes",
			link: "https://ortaessays.example/essays/notes",
			why:  "",
			ok:   true,
		},
		{
			name: "a thought before the link",
			text: "ler depois sobre cache https://ortaessays.example/essays/notes",
			link: "https://ortaessays.example/essays/notes",
			why:  "ler depois sobre cache",
			ok:   true,
		},
		{
			name: "a thought after the link",
			text: "https://ortaessays.example/essays/notes vale para o projeto",
			link: "https://ortaessays.example/essays/notes",
			why:  "vale para o projeto",
			ok:   true,
		},
		{
			name: "the link in the middle keeps both sides as one note",
			text: "isso https://ortaessays.example/essays/notes responde a dúvida",
			link: "https://ortaessays.example/essays/notes",
			why:  "isso responde a dúvida",
			ok:   true,
		},
		{
			name: "a sentence's punctuation is not part of the address",
			text: "achei bom https://ortaessays.example/essays/notes.",
			link: "https://ortaessays.example/essays/notes",
			why:  "achei bom",
			ok:   true,
		},
		{
			name: "a second link stays in the note rather than being guessed at",
			text: "https://ortaessays.example/a compara com https://ortaessays.example/b",
			link: "https://ortaessays.example/a",
			why:  "compara com https://ortaessays.example/b",
			ok:   true,
		},
		{
			name: "http is a link too",
			text: "http://ortaessays.example/old",
			link: "http://ortaessays.example/old",
			why:  "",
			ok:   true,
		},
		{
			name: "a message with no link is not a save",
			text: "bom dia",
			ok:   false,
		},
		{
			name: "a bare domain is not a link",
			text: "ortaessays.example/essays/notes",
			ok:   false,
		},
		{
			name: "an empty message is not a save",
			text: "",
			ok:   false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			link, why, ok := FirstLink(tc.text)
			if ok != tc.ok {
				t.Fatalf("FirstLink(%q) ok = %v, want %v", tc.text, ok, tc.ok)
			}
			if !tc.ok {
				return
			}
			if link != tc.link {
				t.Errorf("link = %q, want %q", link, tc.link)
			}
			if why != tc.why {
				t.Errorf("why = %q, want %q", why, tc.why)
			}
		})
	}
}

// TestParseSettingsNamesTheSettingThatIsWrong is the startup check. The
// message has to carry the variable's own name: a person who mistyped it is
// reading the exit line of a server that will not start, and "invalid
// configuration" sends them to the wrong file.
func TestParseSettingsNamesTheSettingThatIsWrong(t *testing.T) {
	cases := []struct {
		name      string
		chat      string
		publicURL string
		wants     string
	}{
		{name: "a chat id that is a word", chat: "abc", publicURL: "https://norte.example", wants: "NORTE_TELEGRAM_CHAT"},
		{name: "no chat id at all", chat: "", publicURL: "https://norte.example", wants: "NORTE_TELEGRAM_CHAT"},
		{name: "a relative public URL", chat: "-100123", publicURL: "/biblioteca", wants: "NORTE_PUBLIC_URL"},
		{name: "no public URL at all", chat: "-100123", publicURL: "", wants: "NORTE_PUBLIC_URL"},
		{name: "a public URL that is not http", chat: "-100123", publicURL: "ftp://norte.example", wants: "NORTE_PUBLIC_URL"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseSettings("secret-bot-token", tc.chat, tc.publicURL)
			if err == nil {
				t.Fatalf("ParseSettings(%q, %q) succeeded", tc.chat, tc.publicURL)
			}
			if !strings.Contains(err.Error(), tc.wants) {
				t.Errorf("the error does not name %s: %v", tc.wants, err)
			}
		})
	}
}

// TestParseSettingsAcceptsWhatTelegramActuallySends covers the negative chat id
// a private chat with a bot has, and the trailing slash a person copying their
// own address leaves behind.
func TestParseSettingsAcceptsWhatTelegramActuallySends(t *testing.T) {
	settings, err := ParseSettings("secret-bot-token", " -1001234567890 ", "https://norte.example/")
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	if settings.ChatID != -1001234567890 {
		t.Errorf("ChatID = %d, want -1001234567890", settings.ChatID)
	}
	if want := "https://norte.example/biblioteca/abc"; settings.ItemURL("abc") != want {
		t.Errorf("ItemURL = %q, want %q", settings.ItemURL("abc"), want)
	}
}
