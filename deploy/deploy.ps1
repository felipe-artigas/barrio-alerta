# Despliegue desde Windows sin GitHub: empaqueta el último commit, lo sube por SCP y lo instala.
# Uso:  .\deploy\deploy.ps1 -Server 203.0.113.10 [-User root] [-Port 22] [-Key ~\.ssh\donweb_ed25519]
param(
  [Parameter(Mandatory)] [string] $Server,
  [string] $User = 'root',
  [int] $Port = 22,
  [string] $Key = "$env:USERPROFILE\.ssh\donweb_ed25519"
)
# 'Continue': en PowerShell 5.1, con 'Stop' cualquier aviso en stderr (ej. "npm notice") corta el script.
# Los errores reales se detectan con $LASTEXITCODE después de cada comando.
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (git status --porcelain) { throw 'Hay cambios sin commitear. Hacé commit antes de desplegar.' }
npm test
if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron: no se despliega.' }

$archive = Join-Path $env:TEMP 'barrio-alerta-release.tar.gz'
git archive --format=tar.gz -o $archive HEAD
if ($LASTEXITCODE -ne 0) { throw 'No se pudo empaquetar el código.' }
$sshArgs = @('-i', $Key, '-p', $Port, '-o', 'BatchMode=yes')
$target = "$User@$Server"

scp -i $Key -P $Port -o BatchMode=yes $archive "${target}:/tmp/barrio-alerta-release.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Falló la subida por SCP.' }

$remote = 'set -e; rm -rf /tmp/ba-release; mkdir -p /tmp/ba-release; tar -xzf /tmp/barrio-alerta-release.tar.gz -C /tmp/ba-release; sudo bash /tmp/ba-release/deploy/remote-install.sh /tmp/ba-release'
ssh @sshArgs $target $remote
if ($LASTEXITCODE -ne 0) { throw 'La instalación remota falló (ver logs arriba).' }
Write-Host "Desplegado en http://$Server" -ForegroundColor Green
