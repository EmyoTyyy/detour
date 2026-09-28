# Arrete les boucles de surveillance laissees sur cette machine.
#
# Une session qui regarde la production en direct ouvre un `pwsh -Command "while($true){ ... }"`
# par ssh et le laisse tourner. Quand la session locale disparait, la connexion meurt mais la
# boucle NON: elle continue a relire queue_status.json deux fois par seconde en ecrivant dans un
# tuyau ferme, et elle prend des coeurs aux ouvriers de generation. Quatre s'etaient accumulees
# en une nuit sur une machine a douze coeurs qui en utilise onze pour produire.
#
# Le filtre porte sur la ligne de commande, pas sur le nom du processus: la session qui lance CE
# script est elle aussi un pwsh, et se tuer soi-meme au milieu du menage n'apprend rien a personne.
#
#   powershell -ExecutionPolicy Bypass -File detour\tools\lab\killtails.ps1

function Get-Tails {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'pwsh.exe' -and $_.CommandLine -and $_.CommandLine.Contains('while($true)')
  }
}

$tails = @(Get-Tails)
if ($tails.Count -eq 0) { Write-Output 'aucune boucle de surveillance en cours'; exit 0 }

foreach ($p in $tails) {
  Write-Output ('arret ' + $p.ProcessId + '  demarree ' + $p.CreationDate)
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
Write-Output ('restantes: ' + @(Get-Tails).Count)
Write-Output ('node en cours (generation): ' + @(Get-Process node -ErrorAction SilentlyContinue).Count)
