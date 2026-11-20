"""Correction des durées mal réparties sur Paris ⇄ Mâcon / Lyon-Part-Dieu / Marseille.

Usage :
    python3 python/fix_route_durations.py            # simulation (aucune écriture)
    python3 python/fix_route_durations.py --apply    # sauvegarde datée puis écriture

Chaque correction nomme le segment par ses deux extrémités et l'ancienne
valeur attendue : si les données ont changé depuis l'analyse, le script refuse
d'écrire plutôt que d'appliquer une valeur au mauvais endroit. Un segment qui
porte déjà la nouvelle valeur est ignoré (relance sans effet).

Principes retenus (voir CHANGELOG) :
- les totaux horaires des blocs mal répartis sont conservés quand ils restent
  physiquement possibles, pour ne pas déplacer les heures de passage aux gares ;
- la LGV entre Pasilly et le viaduc de la Roche reprend le profil de
  PAR_MAC_SUD, seul trajet cohérent sur ce tronçon (250-280 km/h) ;
- un train vers Lyon passe Mâcon-Loché sans s'arrêter : l'arrêt éventuel est
  ajouté par la pénalité d'arrêt du moteur, jamais dans la durée de base ;
- Marseille → Paris était l'aller retourné avec un décalage d'un segment (la
  durée suivait le point au lieu du segment) : de Marseille à Mâcon, il
  reprend le miroir exact de l'aller. Autour des longs ouvrages, l'entrée de
  voie 2 est à l'autre extrémité ; le total de chaque bloc d'ouvrages est
  conservé et réparti selon les distances de la voie 2. De Mâcon à Paris, il
  reprend LPD_PAR_NORD, qui passe aussi Mâcon sans s'arrêter.

Stdlib uniquement.
"""

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / 'data' / 'masterRoutes.normalized.json'
BACKUP_DIR = ROOT / 'data' / 'backups'

# trajet -> [(précédent, point inséré, suivant)] : appliqué avant les durées.
# La durée du nouveau segment est fixée par CORRECTIONS (ancienne valeur None).
INSERTIONS = {
    # Valence TGV manquait au retour : Tartaiguille → Claveyson mesurait 55 km
    # en 58 s, et l'arrêt « Valence TGV » proposé par l'app était inopérant.
    'MRS_PAR_NORD': [('TUNNEL_DE_TARTAIGUILLE', 'VALENCE_TGV', 'PRCI_DE_CLAVEYSON_BREN')],
}

# trajet -> [(départ, arrivée, ancienne durée, nouvelle durée)]
CORRECTIONS = {
    'PAR_LPD_SUD': [
        ('BIF_DE_PASILLY', 'VIADUC_D_EPOISSES', 245, 320),
        ('VIADUC_D_EPOISSES', 'PRS_DE_LACOUR_D_ARCENAY', 90, 230),
        ('PRS_DE_LACOUR_D_ARCENAY', 'VIADUC_DE_SAULIEU', 295, 85),
        ('VIADUC_DE_SAULIEU', 'PRS_DE_VIANGES', 245, 236),
        ('PRS_DE_VIANGES', 'PRS_DE_SULLY', 110, 280),
        ('PRS_DE_SULLY', 'VIADUC_DE_LA_DIGOINE_DREE', 115, 87),
        ('CREUSOT_TGV', 'PRS_DE_VAUX_EN_PRE', 305, 276),
        ('PRS_DE_VAUX_EN_PRE', 'PRS_DE_CLUNY', 130, 289),
        ('PRS_DE_CLUNY', 'VIADUC_DE_LA_ROCHE', 185, 115),
        # Solde du bloc Pasilly → Mâcon (2 410 s conservées) : passage à ~230 km/h.
        ('VIADUC_DE_LA_ROCHE', 'MACON_LOCHE', 400, 202),
        # Durées interverties.
        ('PRS_DE_CESSEIN', 'PASSAGE_SOUS_L_A46', 20, 280),
        ('PASSAGE_SOUS_L_A46', 'BIF_MONTANAY', 280, 20),
    ],
    'LPD_PAR_NORD': [
        ('BIF_MONTANAY', 'PASSAGE_SOUS_L_A46', 280, 20),
        ('PASSAGE_SOUS_L_A46', 'PRS_DE_CESSEIN', 20, 280),
        # 363 km/h : reprend la valeur du sens aller (seul ajout net, +122 s).
        ('PRS_DE_CESSEIN', 'MACON_LOCHE', 270, 392),
        ('MACON_LOCHE', 'VIADUC_DE_LA_ROCHE', 400, 202),
        ('VIADUC_DE_LA_ROCHE', 'PRS_DE_CLUNY', 185, 115),
        ('PRS_DE_CLUNY', 'PRS_DE_VAUX_EN_PRE', 130, 289),
        ('PRS_DE_VAUX_EN_PRE', 'CREUSOT_TGV', 305, 276),
        ('VIADUC_DE_LA_DIGOINE_DREE', 'PRS_DE_SULLY', 115, 87),
        ('PRS_DE_SULLY', 'PRS_DE_VIANGES', 110, 280),
        ('PRS_DE_VIANGES', 'VIADUC_DE_SAULIEU', 245, 236),
        ('VIADUC_DE_SAULIEU', 'PRS_DE_LACOUR_D_ARCENAY', 295, 85),
        ('PRS_DE_LACOUR_D_ARCENAY', 'VIADUC_D_EPOISSES', 90, 230),
        ('VIADUC_D_EPOISSES', 'BIF_DE_PASILLY', 240, 320),
        # L'entrée V2 de Vergigny est à 2,8 km du canal : 20 s donnaient 511 km/h.
        ('PRS_TONNERRE', 'BIF_DE_VERGIGNY', 295, 280),
        ('BIF_DE_VERGIGNY', 'VIADUC_SUR_LE_CANAL_DE_BOURGOGNE', 20, 35),
    ],
    # Même tronc commun que PAR_LPD_SUD jusqu'à Mâcon ; au-delà, déjà plausible.
    'PAR_MRS_SUD': [
        ('BIF_DE_PASILLY', 'VIADUC_D_EPOISSES', 245, 320),
        ('VIADUC_D_EPOISSES', 'PRS_DE_LACOUR_D_ARCENAY', 90, 230),
        ('PRS_DE_LACOUR_D_ARCENAY', 'VIADUC_DE_SAULIEU', 295, 85),
        ('VIADUC_DE_SAULIEU', 'PRS_DE_VIANGES', 245, 236),
        ('PRS_DE_VIANGES', 'PRS_DE_SULLY', 110, 280),
        ('PRS_DE_SULLY', 'VIADUC_DE_LA_DIGOINE_DREE', 115, 87),
        ('CREUSOT_TGV', 'PRS_DE_VAUX_EN_PRE', 305, 276),
        ('PRS_DE_VAUX_EN_PRE', 'PRS_DE_CLUNY', 130, 289),
        ('PRS_DE_CLUNY', 'VIADUC_DE_LA_ROCHE', 185, 115),
        ('VIADUC_DE_LA_ROCHE', 'MACON_LOCHE', 400, 202),
    ],
    'MRS_PAR_NORD': [
        ('BIF_DES_TUILERIES', 'TUNNEL_DES_PENNES_MIRABEAU', 240, 68),
        ('TUNNEL_DES_PENNES_MIRABEAU', 'AIX_TGV', 240, 472),
        ('AIX_TGV', 'VIADUC_DE_VENTABREN_1_730_M', 300, 178),
        ('VIADUC_DE_VENTABREN_1_730_M', 'VIADUC_DE_VERNEGUES_1_211_M', 240, 386),
        ('VIADUC_DE_VERNEGUES_1_211_M', 'VIADUC_DE_CHEVAL_BLANC_900_M', 660, 372),
        ('VIADUC_DE_CHEVAL_BLANC_900_M', 'AVIGNON_TGV', 180, 504),
        ('AVIGNON_TGV', 'BIF_D_AVIGNON_NORD', 230, 180),
        ('BIF_D_AVIGNON_NORD', 'SEI_DE_PIOLENC', 115, 330),
        ('SEI_DE_PIOLENC', 'BIF_VERS_LE_RACC_DE_BOLLENE', 180, 230),
        ('BIF_VERS_LE_RACC_DE_BOLLENE', 'VIADUC_SUR_L_A7', 314, 115),
        ('VIADUC_SUR_L_A7', 'SEI_D_ALLAN', 500, 180),
        ('SEI_D_ALLAN', 'TUNNEL_DE_TARTAIGUILLE', 245, 304),
        ('TUNNEL_DE_TARTAIGUILLE', 'VALENCE_TGV', 58, 510),
        ('VALENCE_TGV', 'PRCI_DE_CLAVEYSON_BREN', None, 245),
        ('PRCI_DE_CLAVEYSON_BREN', 'VIADUC_DE_LA_GALAURE', 395, 58),
        ('VIADUC_DE_LA_GALAURE', 'TUNNEL_DE_MEYSSIEZ', 340, 401),
        ('TUNNEL_DE_MEYSSIEZ', 'BIF_DE_GRENAY_NORD', 95, 334),
        ('BIF_DE_GRENAY_NORD', 'LYON_ST_EX', 205, 95),
        ('LYON_ST_EX', 'VIADUC_DE_LA_COTIERE', 125, 177),
        ('VIADUC_DE_LA_COTIERE', 'PONT_SUR_L_A46', 62, 153),
        ('PONT_SUR_L_A46', 'BIF_MONTANAY', 13, 62),
        ('BIF_MONTANAY', 'PASSAGE_SOUS_L_A46', 260, 13),
        ('PASSAGE_SOUS_L_A46', 'PRS_DE_CESSEIN', 392, 260),
        ('PRS_DE_CESSEIN', 'MACON_LOCHE', 165, 392),
        ('MACON_LOCHE', 'VIADUC_DE_LA_ROCHE', 290, 202),
        ('VIADUC_DE_LA_ROCHE', 'PRS_DE_CLUNY', 279, 115),
        ('PRS_DE_CLUNY', 'PRS_DE_VAUX_EN_PRE', 284, 289),
        ('PRS_DE_VAUX_EN_PRE', 'CREUSOT_TGV', 270, 276),
        ('CREUSOT_TGV', 'VIADUC_DE_LA_DIGOINE_DREE', 85, 285),
        ('VIADUC_DE_LA_DIGOINE_DREE', 'PRS_DE_SULLY', 270, 87),
        ('PRS_DE_SULLY', 'PRS_DE_VIANGES', 225, 280),
        ('PRS_DE_VIANGES', 'VIADUC_DE_SAULIEU', 95, 236),
        ('VIADUC_DE_SAULIEU', 'PRS_DE_LACOUR_D_ARCENAY', 255, 85),
        ('PRS_DE_LACOUR_D_ARCENAY', 'VIADUC_D_EPOISSES', 330, 230),
        ('VIADUC_D_EPOISSES', 'BIF_DE_PASILLY', 294, 320),
        ('BIF_DE_PASILLY', 'PRS_TONNERRE', 290, 305),
        ('PRS_TONNERRE', 'BIF_DE_VERGIGNY', 290, 280),
        ('BIF_DE_VERGIGNY', 'VIADUC_SUR_LE_CANAL_DE_BOURGOGNE', 26, 35),
        ('VIADUC_SUR_LE_CANAL_DE_BOURGOGNE', 'PRS_DE_VAUMORT', 290, 300),
        ('PRS_DE_VAUMORT', 'PASSAGE_SOUS_L_A19', 299, 270),
        ('PASSAGE_SOUS_L_A19', 'PRS_DE_MAROLLES', 83, 305),
        ('PRS_DE_MAROLLES', 'VIADUC_DE_MONTEREAU', 343, 85),
        ('VIADUC_DE_MONTEREAU', 'BIF_DE_MOISENAY', 220, 350),
        ('BIF_DE_MOISENAY', 'BIF_DE_SOLERS', 86, 240),
        ('BIF_DE_SOLERS', 'BIF_DE_CHEVRY_COSSIGNY', 300, 75),
        ('BIF_DE_CHEVRY_COSSIGNY', 'TRANCHEE_COUVERTE_DE_VILLECRESNE', 118, 300),
        ('TRANCHEE_COUVERTE_DE_VILLECRESNE', 'TUNNEL_DE_LIMEIL_BREVANNES', 142, 120),
        ('TUNNEL_DE_LIMEIL_BREVANNES', 'BIF_DE_CRETEIL', 350, 145),
        ('BIF_DE_CRETEIL', 'PARIS_LYON', 350, 320),
        ('VALENCE_TGV', 'PRCI_DE_CLAVEYSON_BREN', None, 245),
    ],
    # Durées rangées une ligne trop haut (chacune appartenait au segment
    # suivant) sur Cluny → Vergigny et Vaumort → Paris ; la valeur en double
    # du dernier segment est absorbée par le recalage.
    'MAC_PAR_NORD': [
        ('VIADUC_DE_LA_ROCHE', 'PRS_DE_CLUNY', 279, 115),
        ('PRS_DE_CLUNY', 'PRS_DE_VAUX_EN_PRE', 284, 279),
        ('PRS_DE_VAUX_EN_PRE', 'CREUSOT_TGV', 270, 284),
        ('CREUSOT_TGV', 'VIADUC_DE_LA_DIGOINE_DREE', 85, 270),
        ('VIADUC_DE_LA_DIGOINE_DREE', 'PRS_DE_SULLY', 270, 85),
        ('PRS_DE_SULLY', 'PRS_DE_VIANGES', 225, 270),
        ('PRS_DE_VIANGES', 'VIADUC_DE_SAULIEU', 95, 225),
        ('VIADUC_DE_SAULIEU', 'PRS_DE_LACOUR_D_ARCENAY', 255, 95),
        ('PRS_DE_LACOUR_D_ARCENAY', 'VIADUC_D_EPOISSES', 330, 255),
        ('VIADUC_D_EPOISSES', 'BIF_DE_PASILLY', 294, 330),
        ('BIF_DE_PASILLY', 'PRS_TONNERRE', 290, 294),
        ('PRS_TONNERRE', 'BIF_DE_VERGIGNY', 290, 281),
        ('BIF_DE_VERGIGNY', 'VIADUC_SUR_LE_CANAL_DE_BOURGOGNE', 26, 35),
        ('PRS_DE_VAUMORT', 'PASSAGE_SOUS_L_A19', 299, 290),
        ('PASSAGE_SOUS_L_A19', 'PRS_DE_MAROLLES', 83, 299),
        ('PRS_DE_MAROLLES', 'VIADUC_DE_MONTEREAU', 343, 83),
        ('VIADUC_DE_MONTEREAU', 'BIF_DE_MOISENAY', 220, 343),
        ('BIF_DE_MOISENAY', 'BIF_DE_SOLERS', 86, 220),
        ('BIF_DE_SOLERS', 'BIF_DE_CHEVRY_COSSIGNY', 300, 86),
        ('BIF_DE_CHEVRY_COSSIGNY', 'TRANCHEE_COUVERTE_DE_VILLECRESNE', 118, 300),
        ('TRANCHEE_COUVERTE_DE_VILLECRESNE', 'TUNNEL_DE_LIMEIL_BREVANNES', 142, 118),
        ('TUNNEL_DE_LIMEIL_BREVANNES', 'BIF_DE_CRETEIL', 350, 142),
    ],
}


def haversine_km(lat1, lon1, lat2, lon2):
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def coordinates(point, voie):
    """Mêmes règles que buildEffectiveRoute : entrée propre à la voie si renseignée."""
    lat, lon = point.get(f'lat_V{voie}'), point.get(f'lon_V{voie}')
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return lat, lon
    return point['lat'], point['lon']


def apply_insertions(data):
    """Applique INSERTIONS en place. Retourne (insérés, erreurs) ; déjà présent = ignoré."""
    routes = {route['id']: route for route in data['trajets']}
    inserted, errors = [], []
    for route_id, insertions in INSERTIONS.items():
        route = routes.get(route_id)
        if route is None:
            errors.append(f'{route_id} : trajet introuvable')
            continue
        for before, point_id, after in insertions:
            ids = [point['id'] for point in route['points']]
            if point_id in ids:
                position = ids.index(point_id)
                if ids[position - 1:position + 2] != [before, point_id, after]:
                    errors.append(f'{route_id} : {point_id} présent mais pas entre {before} et {after}')
                continue
            if point_id not in data['points']:
                errors.append(f'{route_id} : point {point_id} absent du dictionnaire')
                continue
            index = next((i for i in range(len(ids) - 1) if ids[i] == before and ids[i + 1] == after), None)
            if index is None:
                errors.append(f'{route_id} : segment {before} → {after} introuvable pour insérer {point_id}')
                continue
            route['points'].insert(index + 1, {'id': point_id, 'durationToNext': None})
            inserted.append((route_id, point_id))
    return inserted, errors


def apply_corrections(data):
    """Applique CORRECTIONS en place. Retourne (modifiés, déjà corrigés, erreurs)."""
    routes = {route['id']: route for route in data['trajets']}
    changed, already, errors = [], [], []
    for route_id, corrections in CORRECTIONS.items():
        route = routes.get(route_id)
        if route is None:
            errors.append(f'{route_id} : trajet introuvable')
            continue
        ids = [point['id'] for point in route['points']]
        for start, end, old, new in corrections:
            index = next((i for i in range(len(ids) - 1) if ids[i] == start and ids[i + 1] == end), None)
            if index is None:
                errors.append(f'{route_id} : segment {start} → {end} introuvable')
                continue
            current = route['points'][index]['durationToNext']
            if current == new:
                already.append((route_id, start, end))
            elif current != old:
                errors.append(f'{route_id} : {start} → {end} vaut {current} s, {old} s attendu')
            else:
                route['points'][index]['durationToNext'] = new
                changed.append((route_id, start, end, old, new))
    return changed, already, errors


def speed_report(data, route_ids):
    points = data['points']
    for route in data['trajets']:
        if route['id'] not in route_ids:
            continue
        voie = route['voie']
        seq = route['points']
        total = sum(point['durationToNext'] or 0 for point in seq[:-1])
        speeds = []
        for a, b in zip(seq, seq[1:]):
            km = haversine_km(*coordinates(points[a['id']], voie), *coordinates(points[b['id']], voie))
            duration = a['durationToNext'] or 0
            speeds.append(km / duration * 3600 if duration else float('inf'))
        print(f'  {route["id"]:13} total {total // 60} min {total % 60:02d} s · '
              f'vitesses {min(speeds):.0f} → {max(speeds):.0f} km/h')


def write_atomic(path, text):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f'.{path.name}.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--apply', action='store_true', help='sauvegarder puis écrire le fichier')
    args = parser.parse_args()

    source = DATA_FILE.read_text(encoding='utf-8')
    data = json.loads(source)
    print('Avant :')
    speed_report(data, CORRECTIONS)
    inserted, errors = apply_insertions(data)
    if not errors:
        changed, already, errors = apply_corrections(data)
    if errors:
        print('Refus, données différentes de celles analysées :', *errors, sep='\n  ')
        return 1
    for route_id, point_id in inserted:
        print(f'{route_id} : {point_id} inséré.')
    print(f'{len(changed)} segment(s) à corriger, {len(already)} déjà corrigé(s).')
    print('Après :')
    speed_report(data, CORRECTIONS)
    if not changed and not inserted:
        return 0
    if not args.apply:
        print('Simulation : relancer avec --apply pour écrire.')
        return 0

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f'masterRoutes.normalized.{date.today().isoformat()}.json'
    if backup.exists():
        backup = backup.with_name(f'{backup.stem}.{os.getpid()}.json')
    shutil.copy2(DATA_FILE, backup)
    print(f'Sauvegarde : {backup.relative_to(ROOT)}')
    write_atomic(DATA_FILE, json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    print(f'Écrit : {DATA_FILE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
