# Luna import rollout

## Outcome

Switch Napkin's shared restaurant import extractor from Claude Haiku 4.5 to the user-selected GPT-5.6 Luna. Preserve the existing application candidate response shape and support text, photo OCR and image extraction. Identify featured destinations rather than comparison restaurants, packaging brands or people. Evaluate the matcha carousel against the user-confirmed cafe, Keiko Uchida, using the actual TikTok title when recovered.

## Done when

- Default requests use the OpenAI Responses API with `gpt-5.6-luna`, low reasoning, bounded output, server-only credentials and request cancellation. An explicit Haiku model setting remains available for rollback.
- The image and single-candidate paths use the selected provider too; no hidden Anthropic-key dependency remains on the Luna path.
- Existing candidate caps, locality fields, warning stance, parser isolation and client wire shape remain compatible. Featured-place instructions exclude comparison-only and product/person entities while retaining genuine listicle stops and neutrally described destinations.
- Extraction caches reject another model or an older extraction contract, including URL, image, async and OCR paths. New extraction writes record the active model and contract.
- Provider errors/refusals/truncation cannot be accepted as a completed structured OpenAI answer or silently become an empty extraction. Preserve typed failures through multi/single extractors and resolver catches, returning the existing error envelope. A successful empty model result must not trigger raw-caption Places suggestions. Tests cover provider routing, text/image transport, cancellation, output limits, failures, parser compatibility and cache validity without real network access.
- The real provider call and a strict activation corpus pass before activation: Papadum only (no Gymkhana/Dishoom/Nando's); exact known listicle sets with explicit permitted name aliases and full recall; no Berenjak/Padella defaults; no added prefixes such as Spitfire; original matcha text cannot establish a venue and must abstain. Title augmentation is labelled controlled until the actual title is retrieved. Existing permissive fixture scoring is tightened through an opt-in exact-name mode and fixture-specific aliases, with tests. The matcha evaluation clearly separates original captured input, user ground truth, actual retrieved title and any controlled title augmentation.
- Required review, CI, merge, deployment smoke and TestFlight release/cleanup are complete before reporting a live switch. If a credential or original post is unavailable, preserve reviewed work and state the precise outstanding requirement.

## Constraints

No DB migration, new UI, broad dedupe/Places rewrite, new subscription purchase, credential export, or automatic provider fallback. Existing user data and saved places remain untouched. Do not substitute a guessed TikTok title or claim a native-agent trial measures API quality, cost or latency. Do not activate the new default while the production OpenAI key is absent.

## Technical design

Add a small server-only provider adapter in `supabase/functions/_shared/importModel.ts`, keeping Anthropic rollback transport and introducing Luna through the Responses API. Structured output uses a root `candidates` object containing the existing candidate fields; the adapter converts it to the array expected by the existing parser. OpenAI requests set `store: false`, low reasoning and a capped total output budget that includes reasoning; unsupported sampling parameters are omitted. Text/image messages preserve the current evidence and call-site AbortSignal. Refusal, incomplete output and non-2xx responses fail the call rather than being salvaged as a partial OpenAI result. The existing public functions remain the integration boundary. Typed provider/configuration/invalid-output errors propagate through wrapper and resolver catches to the existing error envelope; aborted extraction is reported as a timeout if no usable text result exists. A successful empty result is tracked separately so the URL path does not convert semantic abstention to caption-based Places suggestions. This changes failure/empty handling only, not Places ranking or saves.

Update the directly related extraction prompt with the featured-destination instruction used in the preliminary investigation. Preserve warnings with their current stance for existing unticked review behavior. Keep reliable observed spellings, city separate from district, and title/caption authority over incidental packaging. The actual post's metadata recovery is investigated separately before widening implementation scope.

Export one model/config resolver and one extraction contract version. All cache reads check the selected model and contract marker in the existing JSON field; writes use that same resolver and marker. Old rows become cache misses without deleting or migrating records. Update the model eval runner to require the selected provider's credential and allow the official OpenAI host. Historical captured/model outputs remain unchanged.

Planned files: `supabase/functions/_shared/importModel.ts`, `importModel.test.ts`, `visionExtract.ts`, `visionExtract.test.ts`; `supabase/functions/resolve-url/index.ts`; `scripts/eval/extraction/run.ts`, `score.ts`, `score.test.ts` and affected/new regression fixtures; existing `resolve-url/_helpers.ts` and tests if needed to isolate fallback decisions; `package.json`; this task record and separate evaluation artifacts. Metadata transport files will be added only if the actual source establishes a concrete fix, with design review updated before that work.

## Progress and result

13 September: user explicitly approved Luna. Branch `codex/luna-import-model` starts from `fe5c3529e3f85afca838deb85fafa94069dfdad9`, then matching `origin/main`. Existing captured matcha OCR contains no Keiko Uchida text and its cache source URL is null. The original TikTok link was requested after a scoped trace could not recover it. A controlled title augmentation is kept separate from the unrecovered real post.

13 September pre-build review, native reviewer luna_plan_review. Spec Verdict: FAIL; Architecture Verdict: FAIL. Corrections incorporated: strict activation corpus with exact identities/full recall, plus typed errors and successful-empty handling through resolver callers. Resubmitted before implementation.

Second pre-build review: Spec Verdict PASS, Architecture Verdict PASS. Implementation adds the provider adapter, strict parser, cache contract, featured-destination prompt and stricter fixtures/scorer. The server-only OpenAI credential is now configured; a minimal Responses probe succeeded. Production code remains on Haiku.

Real Luna API validation with v1: 10/13 strict fixtures passed. Failures: product/ceramics name selected from original matcha, no Keiko Uchida returned with controlled title, and altered Amsterdam name spelling. Captured token usage estimates about $0.0121 across thirteen text calls at the published rate; model-call latency 1.33–12.56 seconds. This does not test production URL/image budgets, image inputs, retrieval, Places or end-to-end quality. Later Terra/Sol API requests did not complete, so direct comparison remains outstanding. Detailed evidence is retained locally with the task's evaluation artifacts.

Native independent code review initially requested changes: asynchronous failures left jobs pending; photo mode overrode title evidence; default TimeoutError lost its classification; a strict fixture still allowed Spitfire. All four were corrected. Async failure now uses the existing transactional completion RPC with status failed before returning the error; regression tests cover settlement and error classification. The photo prompt correction bumps the contract to v2; exact v1 prompts/results are retained, and v2 has not yet passed API evaluation.

Native delta verdict: APPROVED for a draft candidate PR only, explicitly no merge/activation approval. Reviewer independently ran 44 focused tests, all passing. Owner checks before the final delta: 783 function tests (115 steps, eight ignored), nine scorer tests, 1,784 app tests in 222 suites, app TypeScript and lint (zero errors, 239 warnings). Final full checks and independent Claude review remain to be recorded.

Final local function/scorer checks after the delta: 788 passed (115 steps, eight ignored), nine passed respectively. Resolve-url Deno check, route-tree guard, table-members identity lint, migration timestamp guard and whitespace checks pass. App checks above remain applicable; no app files changed.

Release is held until the failed model cases pass with the final prompt, the actual title path is validated, and production caps/deadlines plus image requests are tested. No merge, deployment, TestFlight build or release cleanup has occurred. The draft preserves the candidate without treating a code-only pass as model acceptance.
