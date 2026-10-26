# Builds a corpus of ordinary English (news, fiction, speeches, reviews, forums, chat, tweets) from the NLTK
# corpora, for checking how often BNet mutes harmless sentences (tools/web-fp.js).
# Run: python3 tools/make-benign.py [out.tsv] [base|extra|all]
#   base  (default) webtext, nps_chat, brown, reuters, movie_reviews -> data/benign.tsv
#   extra twitter_samples, gutenberg, inaugural, abc, state_union, product reviews, pros_cons,
#         switchboard, subjectivity, sentence_polarity: a second, held-out corpus
# Downloads are cached in <out dir>/nltk.
import io, os, re, sys, json, glob, zipfile, urllib.request, xml.etree.ElementTree as ET
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'data', 'benign.tsv')
WHICH = sys.argv[2] if len(sys.argv) > 2 else 'base'
BASE = ['webtext', 'nps_chat', 'brown', 'reuters', 'movie_reviews']
EXTRA = ['twitter_samples', 'gutenberg', 'inaugural', 'abc', 'state_union', 'product_reviews_1',
         'product_reviews_2', 'pros_cons', 'switchboard', 'subjectivity', 'sentence_polarity']
want = {'base': BASE, 'extra': EXTRA, 'all': BASE + EXTRA}[WHICH]
SRC = os.path.join(os.path.dirname(os.path.abspath(OUT)), 'nltk')
os.makedirs(SRC, exist_ok=True)
for c in want:
    if not os.path.isdir(os.path.join(SRC, c)):
        url = 'https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora/%s.zip' % c
        zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read())).extractall(SRC)
out = []
def add(t, src):
    t = re.sub(r'\s+', ' ', t).strip()
    if 15 < len(t) < 600: out.append(src + '\t' + t)
def sentences(text):
    # Prose files wrap lines inside a paragraph; split on blank lines first, then on sentence ends.
    for para in re.split(r'\n\s*\n', text):
        for s in re.split(r'(?<=[.!?])\s+', para.replace('\n', ' ')): yield s
def files(c, pat): return sorted(glob.glob(os.path.join(SRC, c, pat)))

if 'webtext' in want:
    for f in files('webtext', '*.txt'):
        for l in open(f, errors='ignore'): add(l, 'web:' + os.path.basename(f))
if 'nps_chat' in want:
    for f in files('nps_chat', '*.xml'):
        for p in ET.parse(f).getroot().iter('Post'): add(p.text or '', 'chat')
if 'brown' in want:
    for f in files('brown', 'c*'):
        txt = re.sub(r"/[\w\-\$\*\+\.,'`:()]+", '', open(f, errors='ignore').read())
        for s in re.split(r'(?<=[.!?])\s+', txt): add(s.replace(' ,', ',').replace(' .', '.'), 'brown')
if 'reuters' in want:
    for f in files('reuters', 'training/*')[:4000]:
        for s in re.split(r'(?<=[.!?])\s+', open(f, errors='ignore').read()): add(s, 'reuters')
if 'movie_reviews' in want:
    for f in files('movie_reviews', '*/*'):
        for l in open(f, errors='ignore'): add(l, 'review')

if 'twitter_samples' in want:
    for f in files('twitter_samples', '*.json'):
        for l in open(f, errors='ignore'):
            try: add(json.loads(l).get('text', ''), 'tweet')
            except ValueError: pass
if 'gutenberg' in want:
    for f in files('gutenberg', '*.txt'):
        for s in sentences(open(f, errors='ignore').read()): add(s, 'gutenberg:' + os.path.basename(f))
for c, label in [('inaugural', 'inaugural'), ('state_union', 'sotu')]:
    if c in want:
        for f in files(c, '*.txt'):
            for s in sentences(open(f, errors='ignore').read()): add(s, label)
if 'abc' in want:
    for f in files('abc', '*.txt'):
        for s in sentences(open(f, errors='ignore').read()): add(s, 'abc')
for c in ['product_reviews_1', 'product_reviews_2']:
    if c in want:
        for f in files(c, '*.txt'):
            for l in open(f, errors='ignore'):
                if '##' in l: add(l.split('##', 1)[1], 'product')
if 'pros_cons' in want:
    for f in files('pros_cons', '*.txt'):
        for l in open(f, errors='ignore'): add(re.sub(r'</?(?:Pros|Cons)>', '', l), 'proscons')
if 'switchboard' in want:
    for l in open(os.path.join(SRC, 'switchboard', 'discourse'), errors='ignore'):
        # "sd A.3 utt2: I never have either. /" with {F uh, } disfluency marks
        t = re.sub(r'^\S+\s+[AB]\.\d+\s+utt\d+:\s*', '', l)
        add(re.sub(r'\{[A-Z]\s*|[{}/#\[\]+]', '', t), 'switchboard')
if 'subjectivity' in want:
    for f in files('subjectivity', '*.5000'):
        for l in open(f, errors='ignore'): add(l, 'subjectivity')
if 'sentence_polarity' in want:
    for f in files('sentence_polarity', 'rt-polarity.*'):
        for l in open(f, errors='ignore'): add(l, 'polarity')
open(OUT, 'w').write('\n'.join(out))
print(len(out), 'sentences ->', OUT)
