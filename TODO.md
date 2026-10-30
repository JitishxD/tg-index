# TODO

## Done
- [x] User-account login, persisted session
- [x] Resumable backfill, live new/edit/delete, FLOOD_WAIT handling, reconcile/reindex
- [x] All message types indexed + feed rendering, albums
- [x] FTS5 search
- [x] Range streaming (abort-safe), lazy thumbnails
- [x] Drizzle ORM with prepared statements; aggregate caching; skip no-op upserts
- [x] Automatic nested category tree (channel > topic > hashtag) with inclusive counts
- [x] Home channel picker, /all, sidebar tree, breadcrumbs
- [x] Login UI with red error box; status page
- [x] Removed manual categories and migration code

## Next
- [ ] HLS remux/transcode via ffmpeg with direct→copy→h264 fallback
- [ ] Login rate limit per IP
- [ ] Scheduled nightly reconcile
- [ ] Seeking beyond converted part during live transcode (VOD playlist + on-demand segments)
- [ ] Subtitle track extraction (MKV → WebVTT)
- [ ] Audio track picker for multi-audio MKV
- [ ] Watch history / continue watching (localStorage)
- [ ] Render message entities (bold, links)
- [ ] Search filters (kind, channel) in UI
- [ ] Thumb/HLS cache cleanup for deleted items
- [ ] Tests (range parser, extract.ts)

## Not planned
- Manual categories, bot session rotation, horizontal scaling
