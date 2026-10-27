# Import your list

A shopper can bring a list they already have. Paste, a photo, a file, a shared link, the phone share sheet, or speech all land on the same review screen. Each line is matched to a product family already on the shelf. The shopper checks the matches, then adds them to the trip. Store prices are not shown on those tiles.

Nothing here asks for another store’s password.

## What works with no keys

These stay on when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are unset:

- Paste any text (notes, reminders, a cart copy, a recipe, a spreadsheet pasted as text).
- Upload a `.txt` or `.csv` file. The phone reads the file. The server does not store it.
- Paste a public share link for Instacart, Walmart, Amazon, Target, or Kroger. The server fetches that page only. If the store hides the list behind sign-in, the shopper is told to paste the text or send a screenshot.
- Speak, using the browser’s own speech recognition or the iOS/Android speech plugin. The words stay on the phone until the shopper taps Find these items.
- Share text, a link, a photo, or a voice memo into the installed app (Web Share Target).

Photo reading, server transcription, smarter parsing, and “Need ideas?” stay off. The buttons explain that in plain language and leave paste available.

## Railway variables

Set these on the web service only. Do not commit real keys.

| Variable | Required | What it does |
| --- | --- | --- |
| `OPENAI_API_KEY` or `IMPORT_OPENAI_API_KEY` | No | Turns on smarter parsing, photo reading, voice transcription, and suggestions. The `IMPORT_` name wins when both are set. |
| `ANTHROPIC_API_KEY` or `IMPORT_ANTHROPIC_API_KEY` | No | Same jobs except voice. Anthropic cannot transcribe audio. |
| `IMPORT_AI_PROVIDER` | No | `openai`, `anthropic`, or `off`. Unset uses OpenAI when that key exists, otherwise Anthropic. |
| `IMPORT_VISION_PROVIDER` | No | Same choices for photos. |
| `IMPORT_SPEECH_PROVIDER` | No | `openai` or `off`. Unset uses OpenAI only when an OpenAI key exists. |
| `IMPORT_AI_MODEL` | No | Defaults to `gpt-4o-mini`, or `claude-3-5-haiku-latest` when Anthropic is the parser. |
| `IMPORT_VISION_MODEL` | No | Same default as the parser model. |
| `IMPORT_SPEECH_MODEL` | No | Defaults to `whisper-1`. |
| `IMPORT_SPEECH_BASE_URL` | No | Defaults to `https://api.openai.com/v1`. |
| `IMPORT_DAILY_LIMIT` | No | Model calls per shopper per UTC day. Default 30. `0` means no per-shopper cap. |
| `IMPORT_GLOBAL_DAILY_CAP` | No | Model calls for the whole server process per UTC day. Default 400. `0` turns the global cap off. |
| `IMPORT_RATE_LIMIT` | No | Imports per shopper per 10 minutes. Default 30. |

The daily caps live in memory on each server process and reset at UTC midnight. A paste with no model call does not spend the budget. When the budget is used up, paste still works with the built-in reader. Photo, voice upload, and suggestions pause until the next day.

## Privacy

Uploaded images and audio are not written to disk and are not logged. Pasted text, prompts, and transcripts are not logged. The share-target cache entry is deleted as soon as the page reads it. Crash reporting already drops HTTP bodies.

## Left out on purpose

**Kroger purchase history.** The public Kroger API does not offer a purchase-history or saved-list read. This app’s cart scope (`cart.basic:write`) only adds items. `product.compact` is the catalog. There is no “Import my usuals from Kroger” button.

**“Same as last time” and “the usual.”** Those phrases are skipped. They are not expanded into a personal history. The review screen can still save the accepted items with the existing Buy again list on this phone.
