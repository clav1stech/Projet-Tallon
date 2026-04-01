import pandas as pd
import os
from tqdm import tqdm

# --- CONFIGURATION MISE À JOUR ---
# Ta liste de codes lignes spécifique
CODES_A_TRAITER = ["752100", "752000", "830000", "886000", "890000"]
OUTPUT_DIR = "data"
CHUNK_SIZE = 100000  # Optimisation de la mémoire (100k lignes par bloc)

def process_rail_data():
    # Saisie du chemin du fichier
    path = input("Collez le chemin complet du fichier CSV : ").strip().replace('"', '').replace("'", "")
    
    if not os.path.exists(path):
        print(f"❌ Erreur : Impossible de trouver le fichier à l'emplacement : {path}")
        return

    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Initialisation du dictionnaire de stockage
    # On force les codes en string pour éviter les problèmes de comparaison
    results = {str(code): [] for code in CODES_A_TRAITER}
    
    # Colonnes cibles (on ignore le reste pour la performance)
    cols = ["code_ligne", "pk", "vitesse", "altitude", "lat", "lon"]

    # Estimation de la taille pour la barre de progression
    file_size = os.path.getsize(path)
    
    print(f"🚀 Analyse et filtrage des lignes {', '.join(CODES_A_TRAITER)}...")
    
    try:
        # Lecture par morceaux (chunks)
        with tqdm(total=file_size, unit='B', unit_scale=True, desc="Traitement du CSV") as pbar:
            chunks = pd.read_csv(
                path, 
                usecols=cols, 
                sep=',', 
                na_values="NULL", 
                chunksize=CHUNK_SIZE,
                low_memory=False,
                engine='c'
            )
            
            for chunk in chunks:
                # On convertit la colonne code_ligne en string pour la comparaison
                chunk["code_ligne"] = chunk["code_ligne"].astype(str)
                
                for code in CODES_A_TRAITER:
                    mask = chunk["code_ligne"] == code
                    if mask.any():
                        # On retire la colonne code_ligne avant de stocker pour alléger le JSON
                        data_points = chunk[mask].drop(columns=["code_ligne"]).to_dict(orient='records')
                        results[code].extend(data_points)
                
                # Mise à jour de la barre (basée sur une estimation de la progression)
                pbar.update(file_size // (os.path.getsize(path) // (CHUNK_SIZE * 100)))

        print("\n💾 Génération des fichiers JSON...")
        for code, data in results.items():
            if data:
                file_path = os.path.join(OUTPUT_DIR, f"{code}.json")
                # Sauvegarde au format liste d'objets pour le Web
                with open(file_path, 'w', encoding='utf-8') as f:
                    import json
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print(f"  ✅ {code}.json créé avec {len(data)} points.")
            else:
                print(f"  ⚠️ {code} : aucun point trouvé dans le fichier source.")

    except Exception as e:
        print(f"❌ Une erreur est survenue : {e}")

if __name__ == "__main__":
    process_rail_data()