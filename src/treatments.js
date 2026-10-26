/* Treatments: how a muted phrase looks.
 *  - "hide" looks cover the words. The original text is never drawn: a same-length decoy is styled instead,
 *    so nothing can be read through the effect.
 *  - "voice" looks rewrite the phrase so the sentence still reads: the group keeps its name and the claim
 *    turns into its opposite ("Muslims are the scum of humanity" -> "Muslims are our neighbours").
 * Everything is deterministic per phrase, so nothing flickers when X re-draws a post. */
(function (root) {
  'use strict';

  const TREATMENTS = [
    // Hide it
    { id: 'frost', group: 'hide', label: 'Frosted glass', hint: 'Deep frosted glass. Nothing shows through.' },
    { id: 'veil', group: 'hide', label: 'Gradient veil', hint: 'A slow Iris gradient where the words were' },
    { id: 'aurora', group: 'hide', label: 'Aurora', hint: 'Soft drifting northern lights' },
    { id: 'grain', group: 'hide', label: 'Film grain', hint: 'Fine shimmering grain' },
    { id: 'static', group: 'hide', label: 'TV static', hint: 'Old television snow' },
    { id: 'pixel', group: 'hide', label: 'Pixelate', hint: 'Chunky mosaic blocks' },
    { id: 'glitch', group: 'hide', label: 'Glitch', hint: 'Split colour channels and noise' },
    { id: 'redact', group: 'hide', label: 'Ink bar', hint: 'A clean, rounded redaction bar' },
    { id: 'classified', group: 'hide', label: 'Redacted', hint: 'A stamped black bar marked redacted' },
    { id: 'bleep', group: 'hide', label: 'Bleep', hint: 'A broadcast-style bleep' },
    { id: 'grawlix', group: 'hide', label: 'Comic swear', hint: '#@$%! like a comic strip' },
    { id: 'scramble', group: 'hide', label: 'Glyph scramble', hint: 'Abstract glyphs, same length' },
    { id: 'sparkle', group: 'hide', label: 'Sparkles', hint: 'A little trail of stars' },
    { id: 'hearts', group: 'hide', label: 'Hearts', hint: 'Hearts in Iris colours' },
    { id: 'bloom', group: 'hide', label: 'Flower field', hint: 'Little flowers instead of words' },
    { id: 'whisper', group: 'hide', label: 'Whisper', hint: 'Just a few faint dots' },
    // Say something else
    { id: 'kind', group: 'voice', label: 'Kind words', hint: 'Says the opposite, kindly' },
    { id: 'toddler', group: 'voice', label: 'Toddler', hint: 'What a three-year-old would say instead' },
    { id: 'kitten', group: 'voice', label: 'Kitten', hint: 'Purrfectly nice, mrrp' },
    { id: 'grandma', group: 'voice', label: 'Grandma', hint: 'Warm, and worried you haven’t eaten' },
    { id: 'sportscaster', group: 'voice', label: 'Sportscaster', hint: 'Over-excited live commentary' },
    { id: 'bard', group: 'voice', label: 'The Bard', hint: 'Shakespearean praise' },
    { id: 'corporate', group: 'voice', label: 'Corporate', hint: 'Per my last email, everyone is valued' },
    { id: 'pirate', group: 'voice', label: 'Pirate', hint: 'Arr, all hands welcome aboard' },
    { id: 'hype', group: 'voice', label: 'Bestie', hint: 'Hype-friend energy' },
    { id: 'weather', group: 'voice', label: 'Weather report', hint: 'Sunny, with scattered kindness' },
    // Other
    { id: 'vanish', group: 'other', label: 'Vanish', hint: 'Gone, leaving a faint dot' },
    { id: 'shuffle', group: 'other', label: 'Surprise me', hint: 'A different look each time' }
  ];
  const GROUPS = [
    { id: 'hide', label: 'Hide it', short: 'Hide' },
    { id: 'voice', label: 'Say something nicer', short: 'Rewrite' },
    { id: 'other', label: 'Other', short: 'Other' }
  ];
  const byId = id => TREATMENTS.find(t => t.id === id);
  const SHUFFLE_POOL = TREATMENTS.filter(t => t.group !== 'other').map(t => t.id);

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const pick = (arr, seed, salt) => arr[hash(seed + '|' + (salt || '')) % arr.length];

  const ALIAS = { uplift: 'kind' };
  function resolve(id, seed) {
    id = ALIAS[id] || id;
    if (id === 'shuffle') return pick(SHUFFLE_POOL, 's' + seed);
    return byId(id) && id !== 'shuffle' ? id : 'frost';
  }

  /* ---------- decoys for "hide" looks ---------- */
  const LETTERS = 'etaoinshrdlucmfwypvbgk';
  function decoy(original, seed) {
    let h = hash('d' + seed);
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    const n = Math.max(3, [...original].length);
    let out = '', i = 0;
    while (out.length < n) {
      const len = 2 + Math.floor(rnd() * 6);
      for (let k = 0; k < len && out.length < n; k++) out += LETTERS[Math.floor(rnd() * LETTERS.length)];
      if (out.length < n - 1) out += ' ';
      i++;
    }
    return out.trim();
  }
  const GLYPHS = '◆◇◈⬡⬢◦∙◌◍✦✧▴▾⦿⁘⁙';
  const GRAWLIX = '#@$%&!*☠☄☢⚡';
  const FLOWERS = ['🌸', '🌼', '🌱', '🌷', '🌻', '🪷', '🌿'];
  const HEARTS = ['💜', '💙', '🩵', '💚'];
  function repeatFrom(set, original, seed, per) {
    const n = Math.min(14, Math.max(2, Math.round([...original].length / (per || 4))));
    let s = '';
    for (let i = 0; i < n; i++) s += set[hash(seed + i) % set.length];
    return s;
  }
  function hideText(id, original, seed) {
    switch (id) {
      case 'scramble': {
        const chars = [...original]; let s = '';
        for (let i = 0; i < Math.min(chars.length, 60); i++) s += chars[i] === ' ' ? ' ' : GLYPHS[(hash(seed) + i * 31) % GLYPHS.length];
        return s;
      }
      case 'glitch': {
        const d = decoy(original, seed), G = '\u2591\u2592\u2593\u2580\u2584\u258C\u2590';
        let out = '';
        for (let i = 0; i < d.length; i++) out += d[i] === ' ' ? ' ' : (hash(seed + i) % 3 ? G[hash(seed + 'g' + i) % G.length] : d[i]);
        return out;
      }
      case 'grawlix': return repeatFrom(GRAWLIX, original, seed, 2.2);
      case 'sparkle': return repeatFrom(['✦', '✧', '⋆', '✴'], original, seed, 3).split('').join(' ');
      case 'hearts': return repeatFrom(HEARTS, original, seed, 5);
      case 'bloom': return repeatFrom(FLOWERS, original, seed, 4);
      case 'bleep': return 'bleep';
      case 'classified': return 'redacted';
      case 'whisper': return '· · ·';
      case 'vanish': return '';
      case 'pixel': return '█'.repeat(Math.min(24, Math.max(2, Math.round([...original].length / 1.6))));
      default: return decoy(original, seed);
    }
  }

  /* ---------- voices ---------- */
  // Families of claims, so a rewrite fits the grammar of what it replaces.
  const FAMILY = {
    dehum: 'be', 'neg-trait': 'be', crime: 'be', 'lgbt-ill': 'be', 'women-objects': 'be', disabled: 'be', 'political-hostile': 'be',
    'the-problem': 'be', superior: 'be', incapable: 'be', 'not-welcome': 'belong', 'dont-belong': 'belong', 'no-place': 'belong', 'never-integrate': 'belong',
    violent: 'should', exclude: 'should', 'no-rights': 'should', 'no-rights-short': 'should', untrustworthy: 'trust',
    'not-deserve': 'deserve', 'deserve-death': 'deserve', ruining: 'do', 'crime-verbs': 'do', control: 'do', stealing: 'do', breed: 'do', disgust: 'do',
    kitchen: 'belong', 'their-place': 'should'
  };
  const PREFIX = {
    kill: 'verb', 'death-to': 'cheer', 'expel-pre': 'verb', 'ban-pre': 'more', 'hate-pre': 'love', 'hate-verb': 'bless', distrust: 'trustv',
    'never-date': 'date', 'superior-to': 'equal', 'adj-strong': 'adj', 'adj-weak': 'adj', typical: 'adj', 'sick-of': 'fond'
  };

  const V = {
    kind: {
      welcome: 'make yourself at home', care: 'look after yourself', thing: 'kindness', act: 'be kind',
      be: ['our neighbours', 'part of the human family', 'wonderful people', 'people worth knowing', 'as human as anyone', 'valued members of our community', 'kind and decent people', 'people with families and dreams', 'a gift to this country', 'good people, like most people'],
      should: ['be treated with respect', 'feel safe here', 'be welcomed', 'be heard', 'have every right the rest of us have', 'be free to live in peace', 'be protected'],
      deserve: ['respect', 'dignity', 'every good thing', 'to feel at home', 'kindness', 'to be safe', 'equal rights'],
      belong: ['belong here', 'are welcome here', 'are part of us', 'make this place better'],
      trust: ['can be trusted', 'are as trustworthy as anyone', 'deserve our trust'],
      do: ['make our communities better', 'add so much to this country', 'are building good lives here', 'help their neighbours every day', 'enrich the places they live'],
      verb: ['protect', 'welcome', 'stand with', 'celebrate', 'look out for'], love: 'I really respect', bless: 'bless', cheer: 'peace and love to',
      trustv: 'always trust', date: 'would happily date', equal: 'equal to', more: 'more room for', fond: 'fond of',
      adj: ['wonderful', 'kind', 'brilliant', 'decent', 'lovely'],
      noun: ['friend', 'friends'],
      lines: ['Everyone here deserves dignity.', 'People are more than the worst things said about them.', 'Kindness is louder than this.', 'Somewhere, a stranger just helped a stranger.', 'Difference is what makes the world interesting.', 'We are all neighbours, in the end.', 'Respect costs nothing and pays everyone.', 'The world is bigger and kinder than this post.', 'Every person is someone’s whole world.', 'You can disagree and still be decent.', 'There is room at the table for everyone.']
    },
    toddler: {
      welcome: 'come pway at my house', care: 'have a nap and a juice', thing: 'a big hug', act: 'be nice',
      be: ['my bestest fwiends', 'vewy vewy nice', 'sooo cool', 'my favouwite', 'like big warm hugs', 'good at shawing', 'nicer than bwoccoli'],
      should: ['get a sticker', 'have a nap and a cuddle', 'come to my biwthday pawty', 'get extwa juice', 'get the biggest bawoon'],
      deserve: ['a cookie', 'all the stickers', 'a big hug', 'the biggest bawoon', 'a turn on the swing'],
      belong: ['can come play at my house', 'are on my team', 'can sit next to me at snack time'],
      trust: ['can hold my teddy', 'can keep my secwets'],
      do: ['share their toys', 'give the bestest hugs', 'make me giggle', 'build the tallest block towers'],
      verb: ['hug', 'share snacks with', 'give stickers to', 'play tag with', 'draw pictures for'], love: 'I wuv', bless: 'hugs for', cheer: 'yay for',
      trustv: 'always share with', date: 'would hold hands with', equal: 'the same as', more: 'more hugs for', fond: 'vewy happy about',
      adj: ['nice', 'sparkly', 'huggy', 'fwiendly', 'giggly'],
      noun: ['fwiend', 'fwiends'],
      lines: ['me want juice', 'doggy go woof woof!', 'uppy! uppy!', 'where my blankie?', 'i drawed a horsey', 'big truck go vroom', 'i has a sticker', 'mama look, a birdie!', 'the moon is following us', 'i am a dinosaur rawr', 'peekaboo!', 'bubbles!!!', 'evewyone is my fwiend']
    },
    kitten: {
      welcome: 'curl up on the comfy cushion', care: 'have a lovely nap', thing: 'a warm sunbeam', act: 'be purrfectly nice',
      be: ['purrfectly lovely', 'the cat’s whiskers', 'totally pawsome', 'softer than a sunbeam', 'worthy of slow blinks', 'the cat’s pyjamas'],
      should: ['get head scratches', 'nap in the sunniest spot', 'be given all the treats', 'get the comfy cushion'],
      deserve: ['all the treats', 'a warm windowsill', 'endless chin scritches', 'the good cushion'],
      belong: ['are welcome on the comfy cushion', 'can share my sunbeam', 'are part of the clowder'],
      trust: ['can be trusted with the treat drawer', 'get my slow blinks'],
      do: ['purr the loudest', 'knead the blanket of friendship', 'bring good vibes, mrrp', 'chase the red dot of joy'],
      verb: ['purr at', 'slow-blink at', 'headbutt affectionately', 'share a sunbeam with'], love: 'I purr for', bless: 'mrrp, love to', cheer: 'purrs for',
      trustv: 'nap beside', date: 'would share a box with', equal: 'just as fluffy as', more: 'more cuddles for', fond: 'purring about',
      adj: ['purrfect', 'fluffy-hearted', 'pawsome', 'snuggly'],
      noun: ['kitty', 'kitties'],
      lines: ['mrrp', 'meow meow', '*purrs*', 'mew?', '*knocks cup off table*', 'prrrt', '*slow blink*', 'mrow!', '*kneads blanket*', '*curls up in the sun*']
    },
    grandma: {
      welcome: 'stay for dinner, love', care: 'take care of yourself, dear', thing: 'a nice cup of tea', act: 'be lovely to each other',
      be: ['such lovely young people', 'good as gold', 'a credit to their mothers', 'always welcome for Sunday lunch', 'the salt of the earth', 'darlings, every one of them'],
      should: ['come over for a cup of tea', 'take a jumper, it’s cold out', 'have a second helping', 'ring their mothers more often'],
      deserve: ['a hot meal and a warm bed', 'a nice biscuit', 'the good china', 'a cuddle and a slice of cake'],
      belong: ['are always welcome at my table', 'can stay as long as they like', 'are family round here'],
      trust: ['can be trusted with my spare key', 'are as honest as the day is long'],
      do: ['always call their mothers', 'keep the neighbourhood lovely', 'help me with the shopping', 'bring the nicest flowers'],
      verb: ['knit a scarf for', 'bake a pie for', 'feed', 'make a cuppa for'], love: 'I adore', bless: 'bless', cheer: 'a hot dinner for',
      trustv: 'give my spare key to', date: 'would set you up with', equal: 'just as precious as', more: 'more biscuits for', fond: 'ever so fond of',
      adj: ['lovely', 'dear', 'sweet', 'darling'],
      noun: ['dear', 'dears'],
      lines: ['Have you eaten? There’s soup on the stove.', 'Put a jumper on, love.', 'In my day, we were kind to everyone.', 'Come here and give your nan a hug.', 'I’ve made enough scones for the whole street.', 'Don’t forget to ring your mother.']
    },
    sportscaster: {
      welcome: 'welcome to the team', care: 'stay hydrated out there', thing: 'a fair game', act: 'play fair',
      be: ['absolutely world-class', 'playing a blinder today', 'in the form of their lives', 'the MVPs of this neighbourhood', 'pure class from start to finish'],
      should: ['be in the starting line-up', 'get a standing ovation', 'lift the trophy', 'get a lap of honour'],
      deserve: ['a standing ovation', 'the championship', 'a lap of honour', 'the man-of-the-match award'],
      belong: ['are on home turf here', 'are part of the squad', 'have a spot on this team'],
      trust: ['are rock-solid in defence', 'never drop the ball'],
      do: ['bring the house down', 'score for the whole team', 'make it look easy', 'lift everyone around them'],
      verb: ['cheer on', 'high-five', 'draft', 'celebrate'], love: 'I’m a huge fan of', bless: 'what a season for', cheer: 'three cheers for',
      trustv: 'always pass to', date: 'would sign', equal: 'level with', more: 'more game time for', fond: 'loving the form of',
      adj: ['world-class', 'championship', 'legendary', 'unstoppable'],
      noun: ['champ', 'champs'],
      lines: ['And the crowd goes wild for everyone!', 'What a play, what a community!', 'Unbelievable scenes of kindness here today!', 'Everybody makes the team!', 'That’s a home run for decency!']
    },
    bard: {
      welcome: 'make thyself at home', care: 'be well, good friend', thing: 'sweet peace', act: 'be gentle',
      be: ['most noble and fair', 'gentle souls of rare worth', 'as constant as the northern star', 'a glory to this land', 'of honest heart and gentle mind'],
      should: ['be honoured in every hall', 'be welcomed with sweet music', 'be feasted like kings and queens'],
      deserve: ['all honour and good fortune', 'sweet peace and gentle days', 'a place of honour at the feast'],
      belong: ['are welcome in our fair Verona', 'do grace this land', 'have a home within these walls'],
      trust: ['are true as steel', 'keep their word as knights do'],
      do: ['bring light as doth the morning sun', 'fill our days with merriment', 'make this realm the fairer'],
      verb: ['honour', 'embrace', 'sing the praises of', 'raise a cup to'], love: 'I do adore', bless: 'fortune smile upon', cheer: 'all hail',
      trustv: 'trust mine honour to', date: 'would court', equal: 'the equal of', more: 'more honour to', fond: 'most fond of',
      adj: ['noble', 'gentle', 'fair', 'worthy'],
      noun: ['good friend', 'good friends'],
      lines: ['Love all, trust a few, do wrong to none.', 'The quality of mercy is not strained.', 'All are welcome at this feast.', 'Kindness is the noblest act.', 'There is no darkness but ignorance.']
    },
    corporate: {
      welcome: 'welcome aboard', care: 'please prioritise your wellbeing', thing: 'a team-building day', act: 'be inclusive',
      be: ['valued stakeholders', 'key members of the team', 'a core part of our culture', 'exceeding expectations this quarter', 'mission-critical talent'],
      should: ['be looped in', 'get a seat at the table', 'be fast-tracked for promotion', 'be added to the leadership offsite'],
      deserve: ['a seat at the table', 'full benefits', 'a team lunch', 'a glowing performance review'],
      belong: ['are a great culture fit', 'are welcome on every team', 'are part of our core values'],
      trust: ['are fully trusted to deliver', 'have admin access, honestly'],
      do: ['add value across the org', 'drive real impact', 'bring synergy to every meeting', 'move the needle'],
      verb: ['onboard', 'promote', 'circle back with', 'partner with'], love: 'I truly value', bless: 'kudos to', cheer: 'a shout-out to',
      trustv: 'always cc', date: 'would gladly collaborate with', equal: 'aligned with', more: 'more headcount for', fond: 'very aligned with',
      adj: ['high-performing', 'valued', 'strategic', 'best-in-class'],
      noun: ['colleague', 'colleagues'],
      lines: ['Per my last email: everyone is welcome.', 'Let’s take this offline and be kind.', 'Inclusion is a key deliverable this quarter.', 'Great alignment, team.', 'Quick sync: be nice.']
    },
    pirate: {
      welcome: 'welcome aboard, matey', care: 'keep yer head above water', thing: 'buried treasure', act: 'share the grog',
      be: ['fine shipmates, arr', 'worth their weight in gold', 'the treasure of these seas', 'welcome aboard any day', 'the best crew on the seven seas'],
      should: ['get extra rations of grog', 'sail with us', 'share in the plunder', 'be made captain'],
      deserve: ['a chest of gold', 'the captain’s cabin', 'fair winds and following seas'],
      belong: ['be welcome aboard', 'sail under our flag', 'have a hammock on this ship'],
      trust: ['can be trusted with the treasure map', 'be loyal to the last'],
      do: ['keep the ship afloat', 'sing the finest shanties', 'find all the treasure'],
      verb: ['toast', 'welcome aboard', 'share grog with', 'sail with'], love: 'I be fond o’', bless: 'fair winds to', cheer: 'yo ho ho for',
      trustv: 'hand the map to', date: 'would sail the seas with', equal: 'as good as', more: 'more grog for', fond: 'right fond o’',
      adj: ['salty', 'shipshape', 'golden', 'trusty'],
      noun: ['matey', 'mateys'],
      lines: ['Ahoy! All hands are welcome aboard!', 'Arr, there be no enemies on this ship.', 'Hoist the colours of kindness!', 'Every sailor’s a friend here, savvy?']
    },
    hype: {
      welcome: "you're always invited", care: 'take care of yourself bestie', thing: 'good vibes', act: 'be kind fr',
      be: ['absolutely slaying', 'the main characters', 'such a vibe', 'goated, no cap', 'literally iconic', 'that energy we need'],
      should: ['be getting their flowers', 'run the group chat', 'be on everyone’s playlist'],
      deserve: ['their flowers', 'all the love', 'a big W', 'the whole spotlight'],
      belong: ['are always invited', 'are part of the squad', 'have a spot in the group chat'],
      trust: ['are ride or die', 'would never leave you on read'],
      do: ['understood the assignment', 'ate and left no crumbs', 'keep it a hundred', 'bring the best energy'],
      verb: ['hype up', 'stan', 'vibe with', 'send love to'], love: 'I stan', bless: 'sending love to', cheer: 'big W for',
      trustv: 'always ride for', date: 'would go out with', equal: 'on the same level as', more: 'more love for', fond: 'obsessed with',
      adj: ['iconic', 'goated', 'elite', 'valid'],
      noun: ['bestie', 'besties'],
      lines: ['Everyone’s valid, period.', 'Big W for kindness today.', 'No cap, we love to see it.', 'This timeline needs more love fr.', 'Main character energy: being kind.']
    },
    weather: {
      welcome: 'enjoy the sunshine here', care: 'stay warm out there', thing: 'sunshine', act: 'be sunny',
      be: ['sunny with a 100% chance of kindness', 'clear skies all week', 'a warm front moving through', 'perfect beach weather', 'a lovely high-pressure system'],
      should: ['expect sunshine all weekend', 'get the warmest days of spring'],
      deserve: ['blue skies', 'a gentle breeze', 'the sunniest forecast'],
      belong: ['are welcome in every forecast', 'brighten every postcode'],
      trust: ['are as reliable as summer'],
      do: ['bring sunshine wherever they go', 'clear the clouds away'],
      verb: ['forecast sunshine for', 'send a warm front to'], love: 'I’m forecasting love for', bless: 'sunshine for', cheer: 'clear skies for',
      trustv: 'set your watch by', date: 'would share an umbrella with', equal: 'just as sunny as', more: 'more sunshine for', fond: 'warming up to',
      adj: ['sunny', 'balmy', 'bright', 'glorious'],
      noun: ['ray of sunshine', 'rays of sunshine'],
      lines: ['Today: clear skies and kindness everywhere.', 'Forecast: warm, with scattered hugs.', 'A high-pressure system of respect is settling in.', 'Expect light showers of compliments.']
    }
  };

  const capFirst = (s, like) => (like && /^\p{Lu}/u.test(like)) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const SHOUT = like => like && like.length > 6 && like === like.toUpperCase() && /\p{L}/u.test(like);

  function voiceText(id, sp, seed) {
    const v = V[id] || V.kind;
    const text = sp.text || '';
    let out;
    if (sp.kind === 'claim' && sp.group) {
      const fam = FAMILY[sp.pred] || 'be';
      const after = text.slice((sp.groupAt || 0) + sp.group.length).toLowerCase();
      const singular = /^\s*(?:is|was|'s|has|will|isn)/.test(after) || /^(?:islam|judaism|christianity|hinduism|sharia|homosexuality|transgenderism|the quran|the koran|allah|muhammad|mohammed|mohammad|the lgbt community|the lgbtq community|the gay community)$/i.test(sp.group.trim());
      const G = sp.groupSlur ? capFirst(v.noun[1], sp.group) : sp.group;
      if (fam === 'be') out = singular ? G + ' is ' + pick(v.adj, seed, 'adj') : G + ' are ' + pick(v.be, seed, 'be');
      else if (fam === 'should') out = G + ' should ' + pick(v.should, seed, 'sh');
      else if (fam === 'deserve') out = G + (singular ? ' deserves ' : ' deserve ') + pick(v.deserve, seed, 'de');
      else if (fam === 'belong') out = G + ' ' + (singular ? pick(v.belong, seed, 'bl').replace(/^are /, 'is ').replace(/^belong/, 'belongs').replace(/^have /, 'has ').replace(/^can /, 'can ') : pick(v.belong, seed, 'bl'));
      else if (fam === 'trust') out = G + ' ' + (singular ? pick(v.trust, seed, 'tr').replace(/^are /, 'is ') : pick(v.trust, seed, 'tr'));
      else out = G + ' ' + (singular ? 'is ' + pick(v.adj, seed, 'adj') : pick(v.do, seed, 'do'));
    } else if (sp.kind === 'prefix' && sp.group) {
      const role = PREFIX[sp.pre] || 'verb';
      const head = text.slice(0, sp.groupAt || 0);
      const filler = (head.match(/(?:\b(?:all|the|these|those|every|any|them|of|you|single|last|other|such)\s+)+$/i) || [''])[0];
      const lead = head.match(/^\s*((?:i|we|everyone|everybody|most people|normal people)\b)/i);
      let w;
      if (role === 'adj') w = pick(v.adj, seed, 'adj');
      else if (role === 'verb') w = pick(v.verb, seed, 'vb');
      else if (role === 'love') w = v.love.replace(/^I\b/, lead ? lead[1] : 'I');
      else w = v[role] || pick(v.verb, seed, 'vb');
      const grp = sp.groupSlur ? v.noun[1] : sp.group;
      out = w + ' ' + filler + grp;
      if (role === 'adj') out = w + ' ' + grp;
    } else if (sp.kind === 'slur') {
      const plural = /(?:s|z)$/i.test(text.trim()) && !/s$/i.test(sp.word || '');
      out = v.noun[plural ? 1 : 0];
    } else {
      out = phraseText(v, sp, seed);
    }
    out = capFirst(out, text);
    return SHOUT(text) ? out.toUpperCase() : out;
  }

  // Slogans and stand-alone lines: keep the grammar of the spot they sit in.
  const BIGOT = /(?:islamophobic|anti[\s-]?semitic|antisemitic|racist|xenophobic|homophobic|transphobic|misogynist(?:ic)?|sexist|a\s+white\s+supremacist|a\s+nazi)\s*$/i;
  const VIOLENT_IDS = /^(?:kill-them|they-should-die|threat|death-to-x|race-war|infidels|gas-the|only-good-dead|rape-threat|ybmc|41pc|new-holocaust|send-them-back|deserved-it)/;
  function phraseText(v, sp, seed) {
    let text = sp.text || '';
    // Slurs inside a slogan become the voice's friendly noun first.
    for (const [a, b] of sp.inner || []) {
      const w = text.slice(a, b);
      text = text.slice(0, a) + v.noun[/(?:s|z)$/i.test(w) ? 1 : 0] + text.slice(b);
    }
    const id = String(sp.rule || '').split(' | ')[0];
    if (BIGOT.test(text)) return text.replace(BIGOT, (v.adj && pick(v.adj, seed, 'adj')) || 'kind');
    if (/^kys/.test(id) || /kill\s*(?:your|ur)\s*self|kys|neck\s+yourself|hang\s+yourself|unalive/i.test(text)) return v.care;
    if (/^go-back/.test(id)) return v.welcome;
    const lead = text.match(/^\s*((?:all\s+)?(?:women|girls|females|wives|men|gays|muslims|jews|blacks|immigrants|migrants|refugees|trans\s+people|you\s+people|they|these\s+people|those\s+people))\b/i);
    if (lead) {
      if (/kitchen|barefoot|pregnant|belong|place/i.test(text)) return lead[1] + ' belong wherever they choose';
      return lead[1] + ' ' + (/^(?:they)$/i.test(lead[1]) ? 'are ' : 'are ') + pick(v.be, seed, 'be');
    }
    if (/your\s+body,?\s+my\s+choice/i.test(text)) return 'your body, your choice';
    const dt = text.match(/^\s*death\s+to\s+(.+)$/i);
    if (dt) return v.cheer + ' ' + dt[1];
    const og = text.match(/the\s+only\s+good\s+(.+?)\s+(?:is|are)\s+(?:an?\s+)?dead\b/i);
    if (og) return 'every ' + og[1] + ' is ' + pick(v.adj, seed, 'adj');
    if (/\b(?:send|ship|kick|deport|round)\b/i.test(text)) return pick(v.verb, seed, 'vb') + ' them';
    const HARM = /\b(?:kill|murder|shoot|hang|lynch|gas|exterminate|behead|burn|nuke|bomb|drown|hunt|deport|sterili[sz]e|stab|rape|beat|bash|send|ship|kick|round|slaughter|cull|purge|wipe)\b/i;
    if (HARM.test(text)) {
      const out = text.replace(HARM, pick(v.verb, seed, 'vb')).replace(/\b(?:out|up)\b\s*$/i, '').replace(/\s+all\s+back\b/i, ' all back');
      return out;
    }
    if (VIOLENT_IDS.test(id)) return pick(v.verb, seed, 'vb') + ' them';
    if (sp.whole) return pick(v.lines, seed, 'ln');
    return v.thing;
  }

  /* Returns what to draw for a muted phrase: { text } */
  function render(id, sp, seed) {
    const t = byId(id);
    if (t && t.group === 'voice') return { text: voiceText(id, sp, seed), voice: true };
    return { text: hideText(id, sp.text || '', seed), voice: false };
  }

  // Back-compat for older callers.
  function replacement(id, original, seed) { return render(id, { text: original }, seed).text; }

  root.BNetTreatments = { TREATMENTS, GROUPS, resolve, render, replacement, hash, byId, decoy };
})(typeof globalThis !== 'undefined' ? globalThis : this);
