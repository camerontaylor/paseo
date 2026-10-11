---

**APPROVE — retain campaign custom pin `cbc2017186b980e7928bc376cfdeabb90ef56aa2`; no campaign re-pin.**

Verified locally: `custom` now points to `268be1c4b7af16787d920e74b3eed6a564932c8a`, directly parented by the frozen pin. Reflog confirms commit/amend at the reported times. The delta touches only `fork/README.md` and the two survey documents. `origin/custom` remains `a4d692287`; the other four frozen refs are unchanged.

Required record and execution boundaries:

- Record the drift and this ruling in execution-start/deployment records.
- Assemble baskets using frozen **full SHAs**, never mutable `custom`. The proposed dedicated research ref is optional; verify it resolves exactly to `cbc201718…`.
- Leave local `custom` and `origin/custom` untouched.
- Resume the interrupted browser worker on held release base `568b12127`, incorporating approved EXC-3 as planned; preserve its uncommitted work. No rebase onto moved `custom`.

Published A1 ancestry is unaffected: `929d74271` has parents `d62ed60c8` and `831f6a858`. Publication success and seven-package verification are accepted on coordinator report. No additional Cameron sign-off is required to retain the existing pin.
