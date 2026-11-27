$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$npmScript = Join-Path $projectRoot '.tools\npm\package\bin\npm-cli.js'
$npxScript = Join-Path $projectRoot '.tools\npm\package\bin\npx-cli.js'
$node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $npmScript)) {
  throw 'The local npm build tool is missing. Install Node.js with npm, or run this from the prepared Food Tracking workspace.'
}

Push-Location (Join-Path $projectRoot 'watch-functions')
try {
  & $node $npmScript ci --ignore-scripts --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the Watch backend dependencies.' }
} finally {
  Pop-Location
}

Push-Location $projectRoot
try {
  & $node $npxScript --yes firebase-tools login
  if ($LASTEXITCODE -ne 0) { throw 'Firebase sign-in must be completed before deployment.' }
  & $node $npxScript --yes firebase-tools deploy --project glanville-issue-tracker --only functions:gather-watch
  if ($LASTEXITCODE -ne 0) { throw 'Watch deployment failed. Check Firebase sign-in and the project billing plan.' }
} finally {
  Pop-Location
}

Write-Host 'Watch backend deployed. Open Overview > Apple Watch setup in Gather.'
