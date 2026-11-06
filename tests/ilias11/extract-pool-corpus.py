#!/usr/bin/env python3
"""Prepare private ILIAS pool exports for the opt-in exhaustive corpus test.

No question content is bundled in this repository. Output contains solutions and
must stay outside version control. ZIP/XML input is treated as data only.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile


def prepare(archives, output, baseline_ref=None):
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.chmod(0o700)
    (output / 'archives').mkdir(exist_ok=True)
    manifest = {'format': 1, 'pools': [], 'questions': 0}
    with (output / 'questions.jsonl').open('w', encoding='utf-8') as questions:
        for source in archives:
            source = source.resolve(strict=True)
            with zipfile.ZipFile(source) as archive:
                for entry in archive.infolist():
                    name = PurePosixPath(entry.filename)
                    if name.is_absolute() or '..' in name.parts or '\\' in entry.filename:
                        raise ValueError('Unsafe archive path: ' + entry.filename)
                qti_names = [n for n in archive.namelist() if '__qti_' in n and n.endswith('.xml')]
                if len(qti_names) != 1:
                    raise ValueError(f'{source.name}: expected exactly one QTI XML file')
                pool_key = source.stem.rsplit('_', 1)[-1]
                pool = {'key': pool_key, 'archive': 'archives/' + source.name,
                        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                        'manifest': any(n.endswith('/manifest.xml') for n in archive.namelist()),
                        'count': 0, 'types': {}, 'versions': {}}
                types, versions = collections.Counter(), collections.Counter()
                with archive.open(qti_names[0]) as stream:
                    for _, item in ET.iterparse(stream, events=['end']):
                        if item.tag != 'item':
                            continue
                        metadata = {field.findtext('fieldlabel'): field.findtext('fieldentry', '')
                                    for field in item.findall('./itemmetadata/qtimetadata/qtimetadatafield')}
                        types[metadata.get('QUESTIONTYPE', '')] += 1
                        versions[metadata.get('ILIAS_VERSION', '')] += 1
                        pool['count'] += 1
                        document = {'key': pool_key + ':' + str(pool['count']), 'pool': pool_key,
                                    'ordinal': pool['count'], 'ident': item.get('ident'),
                                    'title': item.get('title', ''), 'comment': item.findtext('qticomment', ''),
                                    'question': ''.join(t.text or '' for t in item.findall('./presentation//mattext')),
                                    'maxattempts': int(item.get('maxattempts', '0')), 'metadata': metadata,
                                    'feedback': {}}
                        for feedback in item.findall('./itemfeedback'):
                            ident = feedback.get('ident')
                            if ident in ('response_allcorrect', 'response_onenotcorrect'):
                                document['feedback'][ident] = ''.join(t.text or '' for t in feedback.findall('.//mattext'))
                        questions.write(json.dumps(document, ensure_ascii=False) + '\n')
                        item.clear()
                pool['types'], pool['versions'] = dict(types), dict(versions)
                if set(types) != {'assSQLQuestion'}:
                    raise ValueError(f'{source.name}: corpus includes unsupported types {dict(types)}')
                shutil.copyfile(source, output / pool['archive'])
                manifest['pools'].append(pool)
                manifest['questions'] += pool['count']
    if baseline_ref:
        repository = Path(__file__).resolve().parents[2]
        source_paths = [Path('js/classes/SQL/class.SQLFunctionalDependency.js'),
                        Path('js/classes/SQL/class.SQLResult.js'), Path('js/classes/SQL/class.SQLRun.js'),
                        *[p.relative_to(repository) for p in (repository / 'js/classes/SQL/Errors').glob('*.js')]]
        for source_path in source_paths:
            target = output / 'baseline' / source_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(subprocess.check_output(['git', '-C', str(repository), 'show', baseline_ref + ':' + str(source_path)]))
        (output / 'baseline/revision.txt').write_text(baseline_ref + '\n', encoding='utf-8')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--baseline-ref', help='Previous plugin Git revision used for real-worker comparison')
    parser.add_argument('archives', type=Path, nargs='+')
    args = parser.parse_args()
    prepare(args.archives, args.output, args.baseline_ref)
