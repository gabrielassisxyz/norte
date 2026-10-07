package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// Event is one thing that has happened, as the module that owns it reports it.
//
// The payload carries identifiers and nothing else. A subscriber that needs the
// record reads it from the owning module's provider, which is what keeps a
// reaction correct when it runs again after a replay: the ids still point at the
// current row, while a copy of the row inside the event would not.
type Event struct {
	Name    string
	Payload map[string]string
}

// EventSubscriber reacts to one event. It is called synchronously, inside the
// publisher's own call, after the publisher's transaction has committed.
//
// There is no persistence and no retry here. A reaction that has to survive a
// crash enqueues its own job from the callback, so it is exactly as durable as
// the queue; an error comes back to the publisher, which returns it so the
// worker replays the whole handler and publishes again.
type EventSubscriber func(ctx context.Context, event Event) error

// Events is the in-process publish-subscribe the modules react to each other
// through, so the library never writes a notes table and notes never reads a
// library table.
type Events struct {
	mu          sync.RWMutex
	subscribers map[string][]EventSubscriber
}

// NewEvents returns an empty bus. Subscriptions arrive at startup, from each
// enabled module; a module that is switched off simply never subscribes.
func NewEvents() *Events {
	return &Events{subscribers: map[string][]EventSubscriber{}}
}

// Subscribe adds a reaction to name, after whatever is already subscribed to it.
func (e *Events) Subscribe(name string, subscriber EventSubscriber) {
	if subscriber == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.subscribers == nil {
		e.subscribers = map[string][]EventSubscriber{}
	}
	e.subscribers[name] = append(e.subscribers[name], subscriber)
}

// Publish calls every subscriber of event.Name in registration order and
// returns their errors joined, so one failing reaction does not hide another.
//
// The subscriber list is snapshotted before the first call: a subscriber that
// subscribes while being called would otherwise either be skipped or run inside
// this same publish depending on the slice's spare capacity, and neither is a
// behaviour worth having. A panic becomes an error, because a subscriber is
// another module's code and the publisher is in the middle of a job.
func (e *Events) Publish(ctx context.Context, event Event) error {
	e.mu.RLock()
	registered := e.subscribers[event.Name]
	snapshot := make([]EventSubscriber, len(registered))
	copy(snapshot, registered)
	e.mu.RUnlock()

	var failures []error
	for _, subscriber := range snapshot {
		if err := callEventSubscriber(ctx, subscriber, event); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func callEventSubscriber(ctx context.Context, subscriber EventSubscriber, event Event) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("a subscriber of %s panicked: %v", event.Name, recovered)
		}
	}()
	return subscriber(ctx, event)
}
