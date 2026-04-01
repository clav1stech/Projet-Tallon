import os
import re
import json

# --- CONFIGURATION ---
VERSION_X = 1
VERSION_Y = 0
EXTENSIONS_TO_EXPORT = ('.html', '.css', '.js', '.json')
FILE_PREFIX = "Export_Projet-Tallon"

# Dossier parent et sous-dossier Export
PARENT_DIR = os.path.dirname(os.getcwd())
EXPORT_PATH = os.path.join(PARENT_DIR, "Export")

def get_next_z(directory, x, y):
    """Calcule le prochain index Z pour le couple X.Y donné."""
    if not os.path.exists(directory): return 0
    pattern = re.compile(rf"{FILE_PREFIX}_v{x}\.{y}\.(\d+)\.txt")
    max_z = -1
    for filename in os.listdir(directory):
        match = pattern.match(filename)
        if match:
            z_value = int(match.group(1))
            if z_value > max_z: max_z = z_value
    return max_z + 1

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

def process_json_content(content):
    """Transforme le JSON en exemple structurel léger."""
    try:
        data = json.loads(content)
        # On limite à 2 éléments par liste pour un exemple de structure pur
        is_truncated, processed_data = truncate_recursive(data, limit=2)
        
        new_content = json.dumps(processed_data, indent=4, ensure_ascii=False)
        if is_truncated:
            new_content += "\n\n// [NOTE : Ce contenu est un EXEMPLE structurel (listes imbriquées tronquées)]"
        return new_content
    except:
        return content

def format_size(size_bytes):
    return f"{size_bytes / 1024:.2f} KB"

def run_export():
    project_root = os.getcwd()
    export_folder_name = os.path.basename(EXPORT_PATH)
    
    if not os.path.exists(EXPORT_PATH): os.makedirs(EXPORT_PATH)
    
    z = get_next_z(EXPORT_PATH, VERSION_X, VERSION_Y)
    output_filename = f"{FILE_PREFIX}_v{VERSION_X}.{VERSION_Y}.{z}.txt"
    output_file_path = os.path.join(EXPORT_PATH, output_filename)
    
    files_to_process = []
    
    print("🔍 Analyse et compression des JSON...")
    for root, dirs, files in os.walk(project_root):
        if export_folder_name in dirs: dirs.remove(export_folder_name)
        
        for file in files:
            if file.endswith(EXTENSIONS_TO_EXPORT):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_root)
                
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        raw_content = f.read()
                    
                    # Traitement JSON avec la nouvelle logique récursive
                    content_to_write = process_json_content(raw_content) if file.endswith('.json') else raw_content
                    
                    files_to_process.append({
                        'rel_path': rel_path,
                        'content': content_to_write,
                        'size': len(content_to_write.encode('utf-8'))
                    })
                except Exception as e:
                    print(f" ❌ Erreur : {rel_path} ({e})")

    total_size = sum(f['size'] for f in files_to_process)
    # Tri par poids décroissant pour le récapitulatif
    files_to_process.sort(key=lambda x: x['size'], reverse=True)

    print(f"🚀 Écriture de l'export : {output_filename} ({format_size(total_size)})")
    
    with open(output_file_path, 'w', encoding='utf-8') as outfile:
        outfile.write("================================================\n")
        outfile.write("📊 RÉCAPITULATIF DES POIDS (APPRÈS TRONCATURE JSON)\n")
        outfile.write(f"Poids Total du fichier : {format_size(total_size)}\n")
        outfile.write("================================================\n")
        
        for f in files_to_process:
            pct = (f['size'] / total_size * 100) if total_size > 0 else 0
            outfile.write(f"[{pct:5.1f}%] {format_size(f['size']):>10} | {f['rel_path']}\n")
        
        outfile.write("================================================\n\n\n")

        for f in files_to_process:
            outfile.write(f"=== {f['rel_path']} ===\n\n")
            outfile.write(f['content'])
            outfile.write("\n\n\n")

    print(f"✨ Terminé !")

if __name__ == "__main__":
    run_export()