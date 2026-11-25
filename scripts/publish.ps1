param([string]$Gh = 'gh')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
& $Gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Сначала выполните gh auth login --hostname github.com --git-protocol https --web.' }
$owner = (& $Gh api user --jq .login).Trim()
if ($owner -ne 'miramour') { throw "Ожидался аккаунт miramour, выполнен вход как $owner. Проверьте аккаунт перед публикацией." }
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Git не может прочитать репозиторий. Исправьте ошибку Git перед публикацией.' }
if ($dirty) { throw 'Перед публикацией нужен чистый, закоммиченный рабочий каталог.' }
$remote = $null
if ((git remote) -contains 'origin') { $remote = git remote get-url origin }
if (!$remote) {
  & $Gh repo create 'miramour/cueforge-desktop' --public --source $projectRoot --remote origin --push --description 'Open-source Windows performance soundboard: pads, MIDI, hotkeys, cue output and WAV recording.'
  if ($LASTEXITCODE -ne 0) { throw 'Создание репозитория или отправка исходников не завершены. Проверьте origin и сообщение GitHub перед повтором.' }
} elseif ($remote -eq 'https://github.com/miramour/cueforge-desktop.git' -or $remote -eq 'git@github.com:miramour/cueforge-desktop.git') {
  git push origin main
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось отправить main. Force push не выполнялся.' }
} else { throw "Неожиданный origin: $remote" }
$version = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
$tag = "v$version"
$exe = Join-Path $projectRoot "release/CueForge-$version-Windows-x64.exe"
if (!(Test-Path -LiteralPath $exe)) { throw 'Исходники опубликованы. Для релиза сначала выполните npm run package.' }
$assets = @($exe)
foreach ($name in @('SHA256SUMS.txt','CueForge-demo.zip')) {
  $asset = Join-Path $projectRoot "release/$name"
  if (Test-Path -LiteralPath $asset) { $assets += $asset }
}
& $Gh release create $tag @assets --repo 'miramour/cueforge-desktop' --target main --title "CueForge Desktop $version" --notes-file (Join-Path $projectRoot 'docs/RELEASE_NOTES.md')
if ($LASTEXITCODE -ne 0) { throw 'Исходники опубликованы, но релиз не создан. Существующий релиз не перезаписывался.' }
& $Gh repo view 'miramour/cueforge-desktop' --json url,visibility
& $Gh release view $tag --repo 'miramour/cueforge-desktop' --json url,assets
