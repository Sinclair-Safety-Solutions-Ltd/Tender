# EAS Workflows

Automate builds, submissions, and PR-preview updates with EAS Workflows. The examples below are store-release-oriented starting points.

When you need to write, edit, or validate a workflow YAML file beyond these examples, use the `eas-workflows` skill. For website and API-route deploy workflows (`type: deploy`), see the `eas-hosting` skill.

## PR Previews with EAS Update

Deploy OTA updates for pull requests:

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  publish:
    type: update
    params:
      branch: "pr-${{ github.event.pull_request.number }}"
      message: "PR #${{ github.event.pull_request.number }}"
```

## Production Release

Complete release workflow for both platforms:

```yaml
name: Release

on:
  push:
    tags: ['v*']

jobs:
  build-ios:
    type: build
    params:
      platform: ios
      profile: production

  build-android:
    type: build
    params:
      platform: android
      profile: production

  submit-ios:
    type: submit
    needs: [build-ios]
    params:
      build_id: ${{ needs.build-ios.outputs.build_id }}
      profile: production

  submit-android:
    type: submit
    needs: [build-android]
    params:
      build_id: ${{ needs.build-android.outputs.build_id }}
      profile: production
```

## Build on Push

Trigger builds when pushing to specific branches:

```yaml
name: Build

on:
  push:
    branches:
      - main
      - release/*

jobs:
  build:
    type: build
    params:
      platform: all
      profile: production
```

## Conditional Jobs

Run jobs based on conditions:

```yaml
name: Conditional Release

on:
  push:
    branches: [main]

jobs:
  check-changes:
    outputs:
      has_changes: ${{ steps.detect.outputs.has_changes }}
    steps:
      - name: Detect source changes
        id: detect
        run: |
          if git diff --name-only HEAD~1 | grep -q "^src/"; then
            set-output has_changes true
          else
            set-output has_changes false
          fi

  build:
    type: build
    needs: [check-changes]
    if: ${{ needs.check-changes.outputs.has_changes == 'true' }}
    params:
      platform: all
      profile: production
```

## Tips

- Use `workflow_dispatch` for manual production releases
- Combine PR previews with GitHub status checks
- Use tags for versioned releases
- Keep sensitive values in EAS Secrets, not workflow files
