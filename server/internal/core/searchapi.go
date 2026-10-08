package core

import (
	"context"

	coreapi "github.com/gabrielassisxyz/norte/server/gen/api/core"
)

// SearchCore answers one query across the enabled modules and the subjects.
func (h APIHandlers) SearchCore(ctx context.Context, request coreapi.SearchCoreRequestObject) (coreapi.SearchCoreResponseObject, error) {
	if err := h.ready(); err != nil {
		return coreapi.SearchCoredefaultJSONResponse(coreAPIRefusal(errNoDatabase, ctx)), nil
	}
	entries, err := h.search.Search(ctx, request.Params.Q)
	if err != nil {
		if rendered, ok := coreAPIFailure(err, ctx); ok {
			return coreapi.SearchCoredefaultJSONResponse(rendered), nil
		}
		return nil, err
	}
	return coreapi.SearchCore200JSONResponse(coreapi.SearchResults{
		Entries: mapSearchEntries(entries),
	}), nil
}

func mapSearchEntries(entries []SearchEntry) []coreapi.SearchHit {
	out := make([]coreapi.SearchHit, 0, len(entries))
	for _, entry := range entries {
		hit := coreapi.SearchHit{
			Id:     entry.ID,
			Module: entry.Module,
			Type:   entry.Type,
			Title:  entry.Title,
			Path:   entry.Path,
			Score:  float32(entry.Score),
		}
		// Left out rather than sent empty: the contract says a subtitle is
		// absent when the module has none, and a client rendering "" into a
		// second line gets a blank row it has to guess the height of.
		if entry.Subtitle != "" {
			subtitle := entry.Subtitle
			hit.Subtitle = &subtitle
		}
		out = append(out, hit)
	}
	return out
}
