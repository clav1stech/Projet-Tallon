"""
Export du projet pour partage de contexte avec l'IA (ou relecture humaine).

Deux modes :

  python python/export.py
      Export complet : génère DEUX fichiers en une passe, sous la vraie version
      courante (lue en tête de CHANGELOG.md) :
        - ..._ia_<date>.txt   : profil léger — JSON tronqué (exemples de structure),
          précédé d'un manifeste (arborescence + rôle d'un mot de chaque fichier)
          pour orienter l'IA sans lui faire lire tout le contenu.
        - ..._full_<date>.txt : profil complet — mêmes fichiers, JSON intégral,
          pour quand le détail des données est nécessaire.

  python python/export.py --lite release
      Diff (patch texte) depuis la dernière release (dernier tag vX.Y.0 : début
      de la ligne mineure en cours) jusqu'à l'état actuel du répertoire de travail.

  python python/export.py --lite commit
      Diff depuis le dernier commit de version (dernier tag vX.Y.Z, quel que
      soit Z) jusqu'à l'état actuel — ne montre que le dernier incrément.

Voir docs/commands.md pour le détail des cas d'usage.

Dépendances : stdlib uniquement. Le mode --lite nécessite un dépôt git avec
des tags de version (vX.Y.Z) ; la détection de version nécessite CHANGELOG.md.
"""
import argparse
import os
import re
import json
import subprocess
from datetime import date

# --- CONFIGURATION ---
EXTENSIONS_TO_EXPORT = ('.html', '.css', '.js', '.json', '.md', '.py')
FILE_PREFIX = "Export_Projet-Tallon"
# .cursorrules/.clauderules (vides) et .DS_Store : jamais du contenu utile, pas d'extension dédiée.

# Noms de dossiers jamais parcourus par le mode complet (dépendances, outillage,
# données brutes volumineuses : voir CLAUDE.md § Git). Comparé par nom de dossier,
# à n'importe quelle profondeur.
EXCLUDED_DIR_NAMES = {'node_modules', '.git', '.claude', '.vscode', 'raw'}

# Description courte par fichier (miroir condensé de CONVENTIONS.md § "Où mettre
# quoi") : sert de manifeste pour orienter l'IA sans qu'elle lise tout le code.
# À tenir à jour manuellement si un fichier change de rôle ou si un module est ajouté.
MODULE_SUMMARY = {
    'index.html': "Page principale de l'application de suivi.",
    'master-editor.html': "Page de l'éditeur visuel de trajets.",
    'css/styles.css': "Styles de l'application (mobile + HUD paysage).",
    'js/state.js': "État global (STATE), persistance localStorage des réglages.",
    'js/geo.js': "Primitives géométriques pures (Haversine, projection sur segment).",
    'js/functions.js': "Moteur de calcul pur : route effective, matching segment, retard.",
    'js/ui.js': "Rendu DOM : timeline, widget de suivi, HUD paysage.",
    'js/app.js': "Orchestration : écouteurs DOM, boucle de tracking, bascule GPS/WiFi/Scriptable.",
    'js/routes-config.js': "MAIN_ROUTES, trajets proposés dans le sélecteur (app + éditeur).",
    'js/utils.js': "Utilitaires génériques sans dépendance métier.",
    'js/fakeGeoSim.js': "Simulateur GPS de dev (désactivé par défaut, ENABLE_FAKE_GPS).",
    'js/master-editor.js': "Logique de l'éditeur visuel de masterRoutes.normalized.json.",
    'data/masterRoutes.normalized.json': "Source de vérité géo/horaire (schéma v3) : points + trajets.",
    'data/servicePatterns.json': "Patterns de desserte nommés (arrêts intermédiaires par trajet).",
    'CLAUDE.md': "Instructions IA : règles transverses + invariants spécifiques au projet.",
    'CONVENTIONS.md': "Conventions de code : style, \"où mettre quoi\".",
    'README.md': "Présentation du projet, architecture, mise en route.",
    'CHANGELOG.md': "Historique des versions (source de vérité pour le numéro courant).",
    'docs/commands.md': "Référence des commandes exécutables du projet (scripts python/, etc.).",
    'python/export.py': "Ce script : génère les exports de contexte projet pour l'IA.",
    'python/migrate_v2_to_v3.py': "Migration ponctuelle du schéma masterRoutes v2 → v3 (déjà appliquée).",
    'python/extract_pk.py': "Extraction interactive de points kilométriques SNCF depuis un CSV brut.",
}

# Dossier Export à la racine du projet (généré, jamais versionné — voir .gitignore)
EXPORT_PATH = os.path.join(os.getcwd(), "Export")


def get_current_version(project_root):
    """Lit la version courante en tête de CHANGELOG.md (source de vérité, cf. CLAUDE.md)."""
    changelog_path = os.path.join(project_root, 'CHANGELOG.md')
    with open(changelog_path, 'r', encoding='utf-8') as f:
        for line in f:
            match = re.match(r'##\s*v(\d+\.\d+\.\d+)', line)
            if match:
                return match.group(1)
    raise RuntimeError("Version introuvable en tête de CHANGELOG.md (attendu : '## vX.Y.Z - date').")


def run_git(args, cwd):
    result = subprocess.run(['git'] + args, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Commande git échouée (git {' '.join(args)}) : {result.stderr.strip()}")
    return result.stdout


def get_sorted_version_tags(project_root):
    """Tags vX.Y.Z triés du plus récent au plus ancien (ordre sémantique, pas alphabétique)."""
    output = run_git(['tag', '--list', 'v*', '--sort=-v:refname'], project_root)
    return [t for t in output.splitlines() if re.match(r'^v\d+\.\d+\.\d+$', t)]


def resolve_lite_ref(project_root, mode):
    """mode='commit' -> dernier tag toutes versions confondues (dernier vX.Y.Z).
    mode='release'  -> dernier tag de début de ligne mineure (dernier vX.Y.0)."""
    tags = get_sorted_version_tags(project_root)
    if not tags:
        raise RuntimeError("Aucun tag de version (vX.Y.Z) trouvé dans le dépôt.")
    if mode == 'commit':
        return tags[0]
    for tag in tags:
        if re.match(r'^v\d+\.\d+\.0$', tag):
            return tag
    raise RuntimeError("Aucun tag de release (vX.Y.0) trouvé.")


def truncate_recursive(data, limit=2):
    """Parcourt récursivement le JSON pour limiter la taille des listes."""
    truncated = False
    if isinstance(data, list):
        if len(data) > limit:
            data = data[:limit]
            truncated = True
        for i in range(len(data)):
            child_truncated, data[i] = truncate_recursive(data[i], limit)
            if child_truncated: truncated = True
    elif isinstance(data, dict):
        for key, value in data.items():
            child_truncated, data[key] = truncate_recursive(value, limit)
            if child_truncated: truncated = True
    return truncated, data


def process_json_content(content, truncate):
    """Profil 'ia' : exemple structurel léger. Profil 'full' : contenu intégral."""
    if not truncate:
        return content
    try:
        data = json.loads(content)
        is_truncated, processed_data = truncate_recursive(data, limit=2)
        new_content = json.dumps(processed_data, indent=4, ensure_ascii=False)
        if is_truncated:
            new_content += "\n\n// [NOTE : Ce contenu est un EXEMPLE structurel (listes imbriquées tronquées)]"
        return new_content
    except (json.JSONDecodeError, ValueError):
        return content


def format_size(size_bytes):
    return f"{size_bytes / 1024:.2f} KB"


def collect_files(project_root):
    """Parcourt le projet et lit le contenu brut des fichiers pertinents (une seule passe,
    réutilisée pour les deux profils ia/full afin de ne lire chaque fichier qu'une fois)."""
    export_folder_name = os.path.basename(EXPORT_PATH)
    files = []
    print("🔍 Analyse des fichiers du projet...")
    for root, dirs, filenames in os.walk(project_root):
        dirs[:] = [d for d in dirs if d != export_folder_name and d not in EXCLUDED_DIR_NAMES]

        for filename in filenames:
            if filename.endswith(EXTENSIONS_TO_EXPORT):
                file_path = os.path.join(root, filename)
                rel_path = os.path.relpath(file_path, project_root)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        raw_content = f.read()
                    files.append({'rel_path': rel_path, 'raw_content': raw_content, 'is_json': filename.endswith('.json')})
                except Exception as e:
                    print(f" ❌ Erreur : {rel_path} ({e})")
    return files


def build_manifest(files):
    """Arborescence + rôle d'un mot par fichier, pour orienter l'IA à faible coût de tokens."""
    lines = ["Arborescence et rôle des fichiers :"]
    for f in sorted(files, key=lambda x: x['rel_path']):
        summary = MODULE_SUMMARY.get(f['rel_path'].replace(os.sep, '/'), "—")
        lines.append(f"  {f['rel_path']:<45} — {summary}")
    return "\n".join(lines)


def write_export(output_path, files, profile, version):
    truncate_json = (profile == 'ia')
    processed = []
    for f in files:
        content = process_json_content(f['raw_content'], truncate_json) if f['is_json'] else f['raw_content']
        processed.append({'rel_path': f['rel_path'], 'content': content, 'size': len(content.encode('utf-8'))})

    total_size = sum(f['size'] for f in processed)
    processed.sort(key=lambda x: x['size'], reverse=True)

    with open(output_path, 'w', encoding='utf-8') as outfile:
        outfile.write("================================================\n")
        outfile.write(f"Projet-Tallon v{version} — profil '{profile}'\n")
        outfile.write("================================================\n")
        outfile.write(build_manifest(files))
        outfile.write("\n================================================\n")
        outfile.write("📊 RÉCAPITULATIF DES POIDS\n")
        outfile.write(f"Poids Total du fichier : {format_size(total_size)}\n")
        outfile.write("================================================\n")
        for f in processed:
            pct = (f['size'] / total_size * 100) if total_size > 0 else 0
            outfile.write(f"[{pct:5.1f}%] {format_size(f['size']):>10} | {f['rel_path']}\n")
        outfile.write("================================================\n\n\n")

        for f in processed:
            outfile.write(f"=== {f['rel_path']} ===\n\n")
            outfile.write(f['content'])
            outfile.write("\n\n\n")

    return total_size


def run_full_export():
    project_root = os.getcwd()
    if not os.path.exists(EXPORT_PATH):
        os.makedirs(EXPORT_PATH)

    version = get_current_version(project_root)
    today = date.today().isoformat()
    files = collect_files(project_root)

    for profile in ('ia', 'full'):
        output_filename = f"{FILE_PREFIX}_v{version}_{profile}_{today}.txt"
        output_path = os.path.join(EXPORT_PATH, output_filename)
        size = write_export(output_path, files, profile, version)
        print(f"✨ [{profile}] {output_filename} ({format_size(size)})")


def run_lite_export(mode):
    project_root = os.getcwd()
    if not os.path.exists(EXPORT_PATH):
        os.makedirs(EXPORT_PATH)

    version = get_current_version(project_root)
    ref = resolve_lite_ref(project_root, mode)
    today = date.today().isoformat()

    diff_stat = run_git(['diff', '--stat', ref, '--', '.', ':(exclude)*.DS_Store'], project_root)
    diff_full = run_git(['diff', ref, '--', '.', ':(exclude)*.DS_Store'], project_root)

    output_filename = f"{FILE_PREFIX}_v{version}_lite-{mode}-depuis-{ref}_{today}.txt"
    output_path = os.path.join(EXPORT_PATH, output_filename)

    with open(output_path, 'w', encoding='utf-8') as outfile:
        outfile.write("================================================\n")
        outfile.write(f"Projet-Tallon v{version} — diff lite ({mode}) depuis {ref}\n")
        outfile.write("================================================\n")
        outfile.write(diff_stat)
        outfile.write("================================================\n\n")
        outfile.write(diff_full if diff_full.strip() else "(aucune modification depuis cette référence)\n")

    size = os.path.getsize(output_path)
    print(f"✨ [lite-{mode}] {output_filename} ({format_size(size)}) — depuis {ref}")


def parse_args():
    parser = argparse.ArgumentParser(description="Export du projet Projet-Tallon pour partage de contexte.")
    parser.add_argument(
        '--lite', choices=['release', 'commit'], default=None,
        help="Export allégé : diff depuis la dernière release (vX.Y.0) ou depuis le dernier commit de version (vX.Y.Z), au lieu de l'export complet."
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.lite:
        run_lite_export(args.lite)
    else:
        run_full_export()
