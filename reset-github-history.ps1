# ZockerFreunde: main auf einen einzigen neuen Commit setzen
# Vorher sicherstellen, dass du im richtigen Projektordner bist.
git checkout --orphan clean-main
git add .
git commit -m "Initial commit"
git branch -D main
git branch -m main
git push --force origin main
Write-Host "Fertig: main wurde auf einen neuen Initial-Commit gesetzt."
