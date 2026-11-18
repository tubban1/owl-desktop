# Xiaohongshu publishing — v1.1.0 (Windows live-page observations)

> Agent guidance only, **not** execution authority or platform approval. 2026-11-18 live inspection on the signed-in creator page `https://creator.xiaohongshu.com/publish/publish`. The sample was a 77.82-second 720×1280 AI-generated Chongqing video. No final publish click was made. Anything not actually tested is marked **UNVERIFIED**.

## 0. Preparation and independent evidence

- Confirm the exact media SHA-256 and local source. Work from an OWL-authorized upload root; copying a byte-identical file there is allowed, but never relax upload roots or substitute a different video.
- Render **both** 9:16 portrait and 16:9 landscape cover images **before** visiting the upload form. Extract a strong frame rather than assuming first frame is suitable; retain original aspect ratio and an explicit source timestamp. Record dimensions, path, SHA-256 and source media identity.
- For this **vertical Xiaohongshu video**, the 9:16 cover is the default candidate; keep 16:9 for horizontal placements/other platforms. Do not silently crop the primary subject away. Never claim a cover was installed just because a local file was prepared.
- Actual sample: source `rough-cut-v2.mp4`, strongest city-on-mechanical-legs frame ~62s. The Windows test prepared `cq-v2-cover-vertical-9x16.jpg` (720×1280) and `cq-v2-cover-horizontal-16x9.jpg` (1280×720), preserving the AI label already present in the frame.

### Tested Windows cover-preparation recipe

The Windows test used the installed `imageio_ffmpeg` executable, preserving the source file. Adapt paths and timestamp to each video, and verify outputs before use:

```powershell
$ff = python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
$video = "C:\\path\\to\\video.mp4"
$portrait = "C:\\path\\to\\cover-9x16.jpg"
$landscape = "C:\\path\\to\\cover-16x9.jpg"
& $ff -hide_banner -loglevel error -y -ss 62 -i $video -frames:v 1 -vf 'scale=720:1280' $portrait
& $ff -hide_banner -loglevel error -y -ss 62 -i $video -frames:v 1 -filter_complex '[0:v]split=2[bgsrc][fgsrc];[bgsrc]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=20:2[bg];[fgsrc]scale=405:720[fg];[bg][fg]overlay=(W-w)/2:0' $landscape
```

Inspect both actual images. For a different input aspect ratio, compute the foreground scale from the source and target dimensions; do not hardcode 405px without checking. SHA-256-match the source when copied into OWL's upload root; keep video and cover identities separate in evidence.


## 1. Upload, editor and cover selection

**Observed:** Creator page first displays a video upload tile and a hidden `input[type=file]`, with no title/body fields. After selecting the MP4, the page shows an upload percentage, then filename, resolution warning and editor. The OWL file-upload tool once returned `UPLOAD_INPUT_OR_UI_CONFIRMATION_MISSING` while the site was already uploading at 82%. Re-read the page; **never blindly retry**.

**Observed cover section:** `设置封面`, a preview thumbnail, `默认截取第一帧`, `已为你生成封面`, three AI-generated options, one `已应用`, and a quality-assessment message. The selected page cover is not necessarily the prepared one.

**Required cover procedure:**
1. Compare the prepared portrait cover with the currently applied preview.
2. Open the current cover preview/editor using a **freshly observed safe control**; inspect any dialog and aspect-ratio or upload options. If custom upload is offered, use the portrait file ticket; use 16:9 only if the site's selected destination explicitly requires it.
3. Inspect the dialog after any click/selection. Do not close an unobserved confirmation. Verify the cover shown on the creator page is the chosen one, not merely a local asset or an AI recommendation.
4. If the cover trigger has no usable Agent-owned UID or fails `CURSOR_TARGET_OCCLUDED`, return `COVER_CONTROL_UNAVAILABLE`, preserve the draft and ask for a browser-adapter improvement; do **not** click ungrounded coordinates or substitute another browser profile.

**Not yet verified:** custom cover editor's exact button/asset-picker labels and save dialog. Treat those steps as conditional, not fixed selectors.

## 2. Topics — typed #text is not a selected topic

**Observed:** After entering a body with `#AI生成`, a floating suggestion panel displayed topic candidates and view counts (including `#AI生成`). The initial plain text in the editor did **not** by itself prove a selected platform topic.

**User-specified interaction, to test individually:** For each `#标签` already typed in the body, position the text caret **immediately after the final character of that exact tag**. When the topic suggestion popup opens, select the exact matching topic from **that popup** (not a nearby trending suggestion); check the editor after the selection and capture a new snapshot.

- Do not assume spaces, punctuation, and adjacent `#` text convert automatically to selectable topics.
- When multiple tags exist, repeat tag-by-tag, re-observing the popup after every selection. Do not use a fixed popup row index; rankings and suggestions change.
- Verify a platform topic token/selected state for each exact tag. Plain text alone is `TOPIC_SELECTION_UNVERIFIED`. If no safe caret/option targeting is available, stop; do not certify it.
- Do not use the global `话题` toolbar button as proof that the after-tag contextual menu was handled. That is an alternative workflow requiring separate validation.

**Not yet verified:** a successful click on a topic suggestion from the current Windows OWL Browser. Current browser cursor returned `CURSOR_TARGET_OCCLUDED` for some observed controls, so this must remain a pending real-site gate.

## 3. Original declaration toggle and AI-content type — separate decisions

**Observed:** Under `内容设置` there is a `原创声明` switch displayed off and an `添加内容类型声明` entry with a dropdown chevron. These are custom controls not currently returned by Windows `browser_agent_form_controls`; do not claim they are checked merely because their labels appear in the page text.

**User-specified objective:** Set the switch **immediately to the right of `原创声明`** to on, *only after the rights and platform eligibility are verified and the user's declaration instruction is valid*. Then:
1. Capture the current switch state.
2. Select/check it with an observed, authorized control. If a confirmation dialog appears, read its full text, inspect choices, accept only if applicable and authorized; do not blindly accept terms.
3. Re-observe the switch after dialog dismissal and verify `checked/on`; if absent, ambiguous or blocked, status `ORIGINAL_DECLARATION_UNVERIFIED`.
4. Separately inspect `添加内容类型声明`, choose the applicable AI-generated-content category for an AI-produced video, handle any nested dialog, and re-observe the selected value. An AI watermark or body disclaimer does not itself prove platform disclosure was checked.

**Not yet verified:** the exact originality confirmation modal text, AI content-type menu items and post-save checked state, because the current browser snapshot does not expose their custom controls. **Do not represent these as completed.**

## 4. Modal and retry discipline

Every popover/dialog operation follows `OPEN → INSPECT → SELECT EXACT MATCH → CONFIRM IF AUTHORIZED → RE-INSPECT → RECORD RECEIPT`.

- On an unexpected popup, stop, capture a snapshot/screenshot and classify it. Handle only the observed dialog. Never click behind an overlay or use stale UIDs after the DOM changes.
- A tool transport failure does not imply a page operation failed: re-read the page before retrying, especially for uploads and rich text. The current live trial showed a rich-editor tool error even though the text appeared correctly in the platform preview.
- Preserve the current draft and account. No final `发布` click unless every required field, cover, linked topics, originality eligibility, AI content-type label, and explicit Runtime authorization passes its own gate.
- Distinguish `PREPARED`, `COVER_REVIEW_REQUIRED`, `TOPIC_SELECTION_UNVERIFIED`, `ORIGINAL_DECLARATION_UNVERIFIED`, `AI_DISCLOSURE_UNVERIFIED`, `SUBMISSION_UNCERTAIN`, `PLATFORM_ACCEPTED`, and `PUBLIC_VERIFIED`. A click can never prove publication.

## 5. Evidence binding

Record video SHA-256, portrait/landscape cover SHA-256, page/account, selected cover observed state, each exact topic selection observation, rights provenance, originality and AI declaration states, guidance ID/version/digest, Runtime Skill version, and terminal receipt. Content knowledge has no power to approve execution or relax the Runtime authorization gate.
