# Builds data/benign.tsv: ordinary English text (news, fiction, film reviews, forums, chat) from the
# NLTK corpora, for checking how often BNet mutes harmless sentences. Run: python3 tools/make-benign.py
import io, os, re, glob, zipfile, urllib.request, xml.etree.ElementTree as ET
ROOT = os.path.join(os.path.dirname(__file__), '..', 'data')
SRC = os.path.join(ROOT, 'nltk')
os.makedirs(SRC, exist_ok=True)
for c in ['webtext', 'nps_chat', 'brown', 'reuters', 'movie_reviews']:
    if not os.path.isdir(os.path.join(SRC, c)):
        url = 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/%s.zip' % c
        zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read())).extractall(SRC)
out = []
def add(t, src):
    t = re.sub(r'\s+', ' ', t).strip()
    if 15 < len(t) < 600: out.append(src + '\t' + t)
for f in glob.glob(SRC + '/webtext/*.txt'):
    for l in open(f, errors='ignore'): add(l, 'web:' + os.path.basename(f))
for f in glob.glob(SRC + '/nps_chat/*.xml'):
    for p in ET.parse(f).getroot().iter('Post'): add(p.text or '', 'chat')
for f in glob.glob(SRC + '/brown/c*'):
    txt = re.sub(r"/[\w\-\$\*\+\.,'`:()]+", '', open(f, errors='ignore').read())
    for s in re.split(r'(?<=[.!?])\s+', txt): add(s.replace(' ,', ',').replace(' .', '.'), 'brown')
for f in sorted(glob.glob(SRC + '/reuters/training/*'))[:4000]:
    for s in re.split(r'(?<=[.!?])\s+', open(f, errors='ignore').read()): add(s, 'reuters')
for f in glob.glob(SRC + '/movie_reviews/*/*'):
    for l in open(f, errors='ignore'): add(l, 'review')
open(os.path.join(ROOT, 'benign.tsv'), 'w').write('\n'.join(out))
print(len(out), 'sentences')
