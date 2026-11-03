# Historical speech experiments

The original English/Czech Supertonic and Piper browser experiments are preserved in Git at commit [`33667fc`](https://github.com/Fidasek009/read-aloud/tree/33667fc/lab/local-speech), including their scripts and instructions. They were independent prototypes, not the extension's current inference implementation. Supertonic was not selected; its upstream repository is archived. The Piper experiment predates the production worker and used a different phonemizer build. Neither implementation should be mistaken for current product behavior or current performance evidence.

The lock files, upstream source metadata, and textual licenses/notices from the experiments are retained here for provenance. Their model assets were downloaded separately and are not bundled in this repository. Historical results remain in [`docs/evidence`](../../evidence/); the original experiments can be inspected or reproduced from the linked Git revision, subject to asset and upstream availability. Reproduction requires its historical dependency lock and tooling; it is not covered by the current project test suite.

The prototype currently bundles separately licensed components described in [the licensing inventory](../../licensing.md) and [NOTICE](../../../NOTICE.md). The archived experimental notices do not replace those distribution obligations.
