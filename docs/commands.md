# Commandes du projet

> Référence des commandes exécutables du projet (scripts `python/`, etc.). Ce
> fichier vit au fil du projet : toute commande réutilisable ajoutée au dépôt
> doit y être documentée, avec un exemple d'invocation depuis la racine.

## Export du projet (`python/export.py`)

Génère un ou plusieurs fichiers texte dans `Export/` (à la racine du projet,
gitignoré, jamais versionné) à partir des fichiers `.html/.css/.js/.json/.md/.py` du projet
(code + documentation), en excluant `node_modules/`, `data/raw/`, `.git/`,
`.claude/`, `.vscode/`. La version dans le nom de fichier est lue en tête de
`CHANGELOG.md` (jamais codée en dur). La liste d'extensions et le manifeste
(`MODULE_SUMMARY`) sont à revérifier si un nouveau type de fichier significatif
apparaît dans le projet (`EXTENSIONS_TO_EXPORT` dans `export.py`).

### Export complet — profil IA + profil complet

```
python3 python/export.py
```

Produit deux fichiers en une passe, sous la version courante :

- `Export_Projet-Tallon_v<X.Y.Z>_ia_<date>.txt` — profil léger : contenu JSON
  tronqué (2 premiers éléments de chaque liste, avec note), précédé d'un
  manifeste (arborescence + rôle d'une ligne par fichier, voir `MODULE_SUMMARY`
  dans `export.py`). À privilégier pour donner du contexte à l'IA sans
  gaspiller de tokens sur des données volumineuses.
- `Export_Projet-Tallon_v<X.Y.Z>_full_<date>.txt` — profil complet : mêmes
  fichiers, JSON intégral. À utiliser quand le contenu réel des données
  (`data/masterRoutes.normalized.json`, `data/servicePatterns.json`) est
  nécessaire à la tâche.

Relancer la commande le même jour régénère (écrase) les fichiers du jour ; ce
n'est pas un historique cumulatif.

### Export allégé — diff depuis une version de référence

```
python3 python/export.py --lite release   # depuis la dernière release (dernier tag vX.Y.0)
python3 python/export.py --lite commit     # depuis le dernier commit de version (dernier tag vX.Y.Z)
```

Produit un seul fichier `Export_Projet-Tallon_v<X.Y.Z>_lite-<mode>-depuis-<tag>_<date>.txt`
contenant un `git diff --stat` puis le diff complet entre le tag de référence et
l'état actuel du répertoire de travail (commits + modifications non commitées).
Utile pour donner à l'IA uniquement ce qui a changé, sans réexporter tout le
projet — nécessite des tags `vX.Y.Z` dans le dépôt.

- `release` remonte au début de la ligne mineure en cours (tout le chantier Y) ;
- `commit` ne montre que le dernier incrément (depuis la dernière version taguée).

## Autres scripts `python/`

Scripts one-off, à exécuter manuellement, non couverts par le versionnage
semver du projet :

- `python3 python/migrate_v2_to_v3.py [--dry-run]` — migration ponctuelle du
  schéma `masterRoutes` v2 → v3 (déjà appliquée sur `main`, gardée pour
  référence/rollback).
- `python3 python/extract_pk.py` — extraction interactive de points
  kilométriques SNCF depuis un CSV brut (dépendances `pandas`/`tqdm`).
