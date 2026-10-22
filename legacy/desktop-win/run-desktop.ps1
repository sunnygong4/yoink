param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $desktopRoot "Yoinker.Desktop\Yoinker.Desktop.csproj"
$configPath = Join-Path $desktopRoot "NuGet.Config"
$dotnetPath = Join-Path $env:USERPROFILE ".dotnet\dotnet.exe"
if (-not (Test-Path $dotnetPath)) {
    $dotnetPath = "dotnet"
}

$env:APPDATA = Join-Path $desktopRoot ".appdata"
$env:DOTNET_CLI_HOME = Join-Path $desktopRoot ".dotnet-cli-home"
$env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1"
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
$env:NUGET_PACKAGES = Join-Path $desktopRoot ".nuget\packages"

New-Item -ItemType Directory -Force -Path $env:APPDATA | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $env:APPDATA "NuGet") | Out-Null
New-Item -ItemType Directory -Force -Path $env:DOTNET_CLI_HOME | Out-Null
New-Item -ItemType Directory -Force -Path $env:NUGET_PACKAGES | Out-Null
Copy-Item -Path $configPath -Destination (Join-Path $env:APPDATA "NuGet\NuGet.Config") -Force

$args = @(
    "run",
    "--project", $projectPath,
    "--configfile", $configPath,
    "-v", "minimal"
)
if ($NoBuild) {
    $args += "--no-build"
}

& $dotnetPath @args
