# SonyTime Work Log

Updated: 2026-10-17

## Persistent checkout and Git state

- Repository: `sonym0/SonyTime` (`https://github.com/sonym0/SonyTime.git`)
- Persistent checkout: `/root/SonyTime` (created from the existing remote development branch after checking that this path and the other standard project paths were absent).
- Branch: `feature/data-protection-backups`, tracking `origin/feature/data-protection-backups`.
- HEAD: `f1d2bed8a34a0385384d07dc9c5098983279565c` — `feat: protect attendance data and isolate test APK`.
- The persistent checkout was clean before this worklog was created. This `WORKLOG.md` is the only intended local addition; no commit, push, merge, or release was made.
- The earlier scratch checkout remains at `/root/.hermes/cache/scratch/sonytime-phase1/repo` with its worklog copy retained. The separate `sonytime-audit/repo` checkout on `main`, including its pre-existing untracked files, was not changed.

## Changes in the latest application commit

- Added fail-safe attendance data read/write, validation, backup, restore, and export protections.
- Isolated test-build application identity, storage paths, and storage keys from production.
- Updated the Android APK workflow and documentation. CI builds and uploads the test APK artifact only; no production release or merge to `main` was made.

## Stage 2 automated verification

- `npm test` from `/root/SonyTime` — PASS: 33 passed, 0 failed. Tests use synthetic records and include backup parsing/write-readback behavior and production-vs-test namespace isolation.
- `npm run check:offline` from `/root/SonyTime` — PASS.
- Synthetic in-memory backup/restore smoke test — PASS: created an envelope from synthetic records, parsed it, restored through `persistSessions` using in-memory callbacks, and verified the prior snapshot and restored records.
- Synthetic namespace isolation smoke test — PASS: verified `SonyTime/` production data paths differ from `SonyTimeTest/` test paths and their local-storage keys differ.
- `npm run build` — PASS in the scratch checkout at the same HEAD, using its pre-existing `node_modules`; Vite 8.3.1 completed the web build. No dependencies were installed. Build output is ignored; the scratch Git status remained limited to the pre-existing worklog.
- `git diff --check` — PASS in both checkouts before this new worklog was added. This file was separately checked for trailing whitespace after creation.

## Android environment and device verification

- No `adb`, `sdkmanager`, `emulator`, `avdmanager`, `gradle`, or `java` executable was found on `PATH`.
- `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `JAVA_HOME` were unset; common Android SDK directories were absent; `/root/SonyTime/android` is not generated; no device listing could be obtained because `adb` is unavailable.
- No SDK, emulator, or system setting was installed or changed.
- Therefore no APK was installed, and Android/Capacitor filesystem behavior, sharing, backup/restore, and OS-level side-by-side data isolation remain untested. The automated tests above are synthetic/unit-level evidence, not Android-device evidence.

## GitHub build evidence

For HEAD `f1d2bed8a34a0385384d07dc9c5098983279565c`:

- Offline source check run `39060655661` — completed successfully: https://github.com/sonym0/SonyTime/actions/runs/39060655661
- Android APK build run `39060655663` — completed successfully: https://github.com/sonym0/SonyTime/actions/runs/39060655663
- Test APK artifact `sony-time-test-v1.1-debug-apk`, ID `12111615918`, size 4,158,231 bytes, not expired at the latest check: https://api.github.com/repos/sonym0/SonyTime/actions/artifacts/12111615918/zip
- A successful CI APK build does not substitute for installation and runtime testing on Android.

## Sony AI / Telegram orchestration state

- `sony-ai-orchestrator` is loaded in this Telegram turn via the updated session skill set; `skill_view` confirmed it, and this task followed its inspect/verify/resume workflow.
- Hermes source provides `/reload-skills` as a Gateway slash command without requiring a Gateway restart. This assistant interface has no tool for submitting a user-origin Telegram slash command, so I did not claim that command was executed. No Gateway restart or `skills.auto_load` change was made.

## Stage 3 Android practical validation (2026-10-17)

- Starting state: HEAD remained `f1d2bed8a34a0385384d07dc9c5098983279565c`; the only local change was this worklog. No installed app data or attendance records were read or changed.
- Test-only identity was rechecked in source and workflow: `SONYTIME_TEST_BUILD=1` selects `com.sonytime.app.test` / `Sony Time Test`; `VITE_SONYTIME_TEST_BUILD=true` selects the test storage helper. Production uses `com.sonytime.app`, `SonyTime/`, and `sonytime.` keys; Test uses `com.sonytime.app.test`, `SonyTimeTest/`, and `sonytime.test.` keys. CI verifies the generated APK application ID and debug signature and uploads only the Test APK.
- Automated verification in this phase: `npm test` — PASS, 33 passed and 0 failed; `npm run check:offline` — PASS; `git diff --check` — PASS.
- Synthetic in-memory flow — PASS: created and parsed a valid backup envelope, rejected corrupt JSON without changing the primary data, restored valid records after preserving a previous snapshot, and checked test/production namespace separation. No real files or production data were used.
- An initial one-off smoke-test command passed serialized JSON to `parseBackup`, which expects an envelope object, and failed before any write. I corrected the harness to match the module API; the corrected synthetic flow passed. No application files were changed by either command.
- No Android runtime was available: `adb`, `sdkmanager`, `emulator`, `avdmanager`, `gradle`, `java`, `gcloud`, and `firebase` were not found; SDK/JAVA environment variables and common SDK directories were absent; `/dev/kvm` and the generated `android/` directory were absent. No device listing was possible. No SDK or system settings were installed or changed.
- No tracked Android instrumentation test sources exist. The current APK workflow is a build-and-upload workflow; the other workflow runs only Node tests and the offline check. The tracked Playwright screenshot script was not run: it targets the separate hardcoded path `/mnt/data/SonyTimeAndroidV11/preview`, clears that path's browser `localStorage`, and exercises Excel export rather than Android backup/restore/share.
- GitHub Actions run `39060655663` succeeded on this exact HEAD; its application-ID verification, debug-signature verification, and artifact-upload steps all succeeded. Test APK artifact `12111615918` remained unexpired at the latest check. No new build was triggered because application sources were unchanged and the existing run is for the same commit. This is build evidence, not Android UI/device evidence.
- No production app data was accessed or changed. With no device/emulator, I could not compare installed production data before and after a device test; runtime preservation is not claimed.

### Test-environment comparison and decision

- **Local SDK/emulator:** not selected. This PRoot environment lacks Java, the Android SDK/emulator, and `/dev/kvm`. Android's Linux emulator acceleration uses KVM; software-only emulation is documented as very slow. Installing the SDK and system image here would be a large setup without the hardware acceleration needed for a practical run.
- **GitHub Actions emulator job:** lowest-cost route for a later executable UI test. SonyTime is public; GitHub says standard runners are free for public repositories and Linux hosted runners support Android SDK hardware acceleration. The existing workflow already uses `ubuntu-24.04` and has `workflow_dispatch`, but it only builds the Test APK; the repo has no instrumentation UI test target. A new test harness/job must be added to the branch and pushed before Actions can run it. I did not commit or push anything.
- **Firebase Test Lab:** technically supports cloud virtual/physical devices and Espresso/UI Automator assertions. Its Spark quota includes limited no-cost runs, while the console instrumentation flow requires a Blaze project linked to billing. This environment has no `gcloud`, Firebase project config, or `GOOGLE_APPLICATION_CREDENTIALS` path. Test Lab is scheduled to shut down on September 30, 2027, so it adds project/billing setup and migration risk without enabling a run here.
- Vendor references reviewed: [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [Android Emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration), [Firebase Test Lab quotas/pricing](https://firebase.google.com/docs/test-lab/usage-quotas-pricing), [Test Lab console instrumentation requirements](https://firebase.google.com/docs/test-lab/android/firebase-console), and [Test Lab deprecation](https://firebase.google.com/docs/test-lab/migrate-faq).

## Next step

A true Android result still requires an emulator/device plus an instrumented UI test harness. The lowest-cost next route is a dedicated GitHub Actions emulator test on the public repository after explicit approval to add and push the test workflow. Until then, treat actual Android backup creation, file export/share chooser, import rejection in the UI, on-device restore snapshots, and live production-data before/after comparison as untested. Use synthetic data only.