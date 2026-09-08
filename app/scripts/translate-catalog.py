"""One-time, resumable translation using the application's configured Gemini provider.

Only public catalog IDs/names are sent. Runtime/build uses the reviewed static map,
never an online translation service. Run from app with its API virtualenv.
"""
import asyncio
import json
import os
from pathlib import Path

from dotenv import dotenv_values
from google import genai
from google.genai import types

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'catalog/names.pt-BR.json'
PROMPT = '''Traduza nomes de exercícios físicos para português brasileiro natural de academia.
Retorne JSON array de objetos {id, name}, exatamente um por entrada, mantendo os IDs.
Não omita equipamento, posição, pegada, lateralidade, ângulo, versão (V2 etc.),
amplitude ou qualquer modificador. Não acrescente músculos ou técnica que não constam.
Use supino, desenvolvimento de ombros, remada, puxada, rosca, levantamento terra,
crucifixo, elevação, flexão de braços, prancha, agachamento, afundo, tríceps na polia,
conforme o movimento. Cable = na polia; lever = na máquina; suspender = em suspensão;
band/resistance band = com elástico; weighted = com carga; bodyweight = com peso corporal.
Preserve nomes próprios como Arnold, Scott, Smith e kettlebell/BOSU/TRX/PVC/EZ.
Traduza também nomes descritivos como dead bug, bird dog, mountain climber, good morning,
clean and jerk (arremesso), snatch (arranco), push-up, pull-up; use descrição em português
quando não houver termo consagrado. Não deixe frases em inglês. Máximo 160 caracteres.
Não use o mesmo nome português para variações distintas. Dados de entrada:
'''


async def main():
    cfg = dotenv_values(ROOT / '.env')
    key = os.environ.get('GEMINI_API_KEY') or cfg.get('GEMINI_API_KEY')
    if not key:
        raise SystemExit('GEMINI_API_KEY not configured')
    client = genai.Client(api_key=key)
    rows = json.loads((ROOT / 'catalog/exercises.pt-BR.json').read_text(encoding='utf-8'))
    result = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    pending = [{'id': r['slug'], 'name': r['nameRaw']} for r in rows if r['slug'] not in result]
    semaphore = asyncio.Semaphore(3)
    async def batch(part):
        async with semaphore:
            indexed = [{'id':str(i),'name':r['name']} for i,r in enumerate(part)]
            for attempt in range(5):
                try:
                    response = await client.aio.models.generate_content(
                        model=os.environ.get('GEMINI_TRANSLATION_MODEL','gemini-2.5-flash'), contents=PROMPT + json.dumps(indexed, ensure_ascii=False),
                        config=types.GenerateContentConfig(temperature=0.1, response_mime_type='application/json',
                            response_json_schema={'type':'array','items':{'type':'object','properties':{'id':{'type':'string'},'name':{'type':'string'}},'required':['id','name']}}))
                    translated = json.loads(response.text)
                    assert len(translated) == len(part), f'Count {len(translated)} expected {len(part)}'
                    assert {r['id'] for r in translated} == {r['id'] for r in indexed}, 'Index mismatch'
                    assert all(isinstance(r['name'], str) and 3 <= len(r['name']) <= 160 for r in translated), 'Name length'
                    result.update({part[int(r['id'])]['id']:r['name'] for r in translated})
                    OUT.write_text(json.dumps(dict(sorted(result.items())), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
                    print(f'Translated {len(result)}/{len(rows)}', flush=True)
                    return
                except Exception as error:
                    print(f'Batch retry {attempt+1}: {type(error).__name__} code={getattr(error,"code",None)}' + (f' {error}' if isinstance(error,AssertionError) else ''), flush=True)
                    if attempt == 4: raise RuntimeError('Translation batch failed') from None
                    await asyncio.sleep(30*(attempt+1))
    await asyncio.gather(*(batch(pending[i:i+75]) for i in range(0,len(pending),75)))


if __name__ == '__main__':
    asyncio.run(main())
