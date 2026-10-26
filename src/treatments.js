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
    'never-date': 'date', 'superior-to': 'equal', 'adj-strong': 'adj', 'adj-weak': 'adj', typical: 'adj', 'sick-of': 'fond',
    'too-many': 'many', 'dont-want': 'want', 'free-of': 'free', 'exclude-pre': 'verb', 'kill-strong': 'verb'
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
      verb: ['protect', 'welcome', 'stand with', 'celebrate', 'look out for'], love: 'I really respect', want: 'would love', bless: 'bless', cheer: 'peace and love to',
      trustv: 'always trust', date: 'would happily date', equal: 'equal to', more: 'more room for', fond: 'fond of',
      adj: ['wonderful', 'kind', 'brilliant', 'decent', 'lovely', 'amazing', 'admirable'],
      noun: ['friend', 'friends'], nounV: ['ally', 'allies'],
      lines: ['Everyone here deserves dignity.', 'People are more than the worst things said about them.', 'Kindness is louder than this.', 'Somewhere, a stranger just helped a stranger.', 'Difference is what makes the world interesting.', 'We are all neighbours, in the end.', 'Respect costs nothing and pays everyone.', 'The world is bigger and kinder than this post.', 'Every person is someone’s whole world.', 'You can disagree and still be decent.', 'There is room at the table for everyone.']
    },
    toddler: {
      welcome: 'come pway at my house', care: 'have a nap and a juice', thing: 'big hugs', act: 'be nice',
      be: ['my bestest fwiends', 'vewy, vewy nice', 'sooo cool', 'my favouwite', 'like big warm hugs', 'good at shawing', 'nicer than bwoccoli'],
      should: ['get a sticker', 'have a nap and a cuddle', 'come to my biwthday pawty', 'get extwa juice', 'get the biggest bawoon'],
      deserve: ['a cookie', 'all the stickers', 'a big hug', 'the biggest bawoon', 'a turn on the swing'],
      belong: ['can come play at my house', 'are on my team', 'can sit next to me at snack time'],
      trust: ['can hold my teddy', 'can keep my secwets'],
      do: ['share their toys', 'give the bestest hugs', 'make me giggle', 'build the tallest block towers'],
      verb: ['hug', 'share snacks with', 'give stickers to', 'play tag with', 'draw pictures for'], love: 'I wuv', want: 'want', bless: 'hugs for', cheer: 'yay for',
      trustv: 'always share with', date: 'would hold hands with', equal: 'the same as', more: 'more hugs for', fond: 'vewy happy about',
      adj: ['nice', 'sparkly', 'huggy', 'fwiendly', 'giggly', 'extwa nice', 'awesome'],
      noun: ['fwiend', 'fwiends'], nounV: ['angel', 'angels'],
      lines: ['me want juice', 'doggy go woof woof!', 'uppy! uppy!', 'where my blankie?', 'i drawed a horsey', 'big truck go vroom', 'i has a sticker', 'mama look, a birdie!', 'the moon is following us', 'i am a dinosaur rawr', 'peekaboo!', 'bubbles!!!', 'evewyone is my fwiend']
    },
    kitten: {
      welcome: 'curl up on the comfy cushion', care: 'have a lovely nap', thing: 'warm sunbeams', act: 'be purrfectly nice',
      be: ['purrfectly lovely', 'the cat’s whiskers', 'totally pawsome', 'softer than a sunbeam', 'worthy of slow blinks', 'the cat’s pyjamas'],
      should: ['get head scratches', 'nap in the sunniest spot', 'be given all the treats', 'get the comfy cushion'],
      deserve: ['all the treats', 'a warm windowsill', 'endless chin scritches', 'the good cushion'],
      belong: ['are welcome on the comfy cushion', 'can share my sunbeam', 'are part of the clowder'],
      trust: ['can be trusted with the treat drawer', 'get my slow blinks'],
      do: ['purr the loudest', 'knead the blanket of friendship', 'bring good vibes, mrrp', 'chase the red dot of joy'],
      verb: ['purr at', 'slow-blink at', 'give headbutts to', 'share a sunbeam with'], love: 'I purr for', want: 'would purr for', bless: 'mrrp, love to', cheer: 'purrs for',
      trustv: 'nap beside', date: 'would share a box with', equal: 'just as fluffy as', more: 'more cuddles for', fond: 'purring about',
      adj: ['purrfect', 'fluffy-hearted', 'pawsome', 'snuggly', 'adorable', 'irresistible'],
      noun: ['kitty', 'kitties'], nounV: ['adorable kitty', 'adorable kitties'],
      lines: ['mrrp', 'meow meow', '*purrs*', 'mew?', '*knocks cup off table*', 'prrrt', '*slow blink*', 'mrow!', '*kneads blanket*', '*curls up in the sun*']
    },
    grandma: {
      welcome: 'stay for dinner, love', care: 'take care of yourself, dear', thing: 'cups of tea', act: 'be lovely to each other',
      be: ['such lovely young people', 'good as gold', 'a credit to their mothers', 'always welcome for Sunday lunch', 'the salt of the earth', 'darlings, every one of them'],
      should: ['come over for a cup of tea', 'pop round for a cuppa', 'have a second helping', 'ring their mothers more often'],
      deserve: ['a hot meal and a warm bed', 'a nice biscuit', 'a seat by the fire', 'a cuddle and a slice of cake'],
      belong: ['are always welcome at my table', 'can stay as long as they like', 'are family round here'],
      trust: ['can be trusted with my spare key', 'are as honest as the day is long'],
      do: ['always call their mothers', 'keep the neighbourhood lovely', 'help me with the shopping', 'bring the nicest flowers'],
      verb: ['knit a scarf for', 'bake a pie for', 'feed', 'make a cuppa for'], love: 'I adore', want: 'would love', bless: 'bless', cheer: 'a hot dinner for',
      trustv: 'give my spare key to', date: 'would set you up with', equal: 'just as precious as', more: 'more biscuits for', fond: 'ever so fond of',
      adj: ['lovely', 'precious', 'sweet', 'darling', 'angelic', 'adorable'],
      noun: ['dear', 'dears'], nounV: ['angel', 'angels'],
      lines: ['Have you eaten? There’s soup on the stove.', 'Put a jumper on, love.', 'In my day, we were kind to everyone.', 'Come here and give your nan a hug.', 'I’ve made enough scones for the whole street.', 'Don’t forget to ring your mother.']
    },
    sportscaster: {
      welcome: 'welcome to the team', care: 'stay hydrated out there', thing: 'fair play', act: 'play fair',
      be: ['absolutely world-class', 'playing a blinder today', 'in the form of their lives', 'the MVPs of this neighbourhood', 'pure class from start to finish'],
      should: ['be in the starting line-up', 'get a standing ovation', 'lift the trophy', 'get a lap of honour'],
      deserve: ['a standing ovation', 'the championship', 'a lap of honour', 'the player-of-the-match award'],
      belong: ['are on home turf here', 'are part of the squad', 'have a spot on this team'],
      trust: ['are rock-solid in defence', 'never drop the ball'],
      do: ['bring the house down', 'score for the whole team', 'make it look easy', 'lift everyone around them'],
      verb: ['cheer for', 'high-five', 'draft', 'celebrate'], love: 'I’m a huge fan of', want: 'would happily draft', bless: 'what a season for', cheer: 'three cheers for',
      trustv: 'always pass to', date: 'would sign', equal: 'level with', more: 'more game time for', fond: 'loving the form of',
      adj: ['world-class', 'championship', 'legendary', 'unstoppable', 'elite', 'all-star'],
      noun: ['champ', 'champs'], nounV: ['all-star', 'all-stars'],
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
      verb: ['honour', 'embrace', 'sing the praises of', 'raise a cup to'], love: 'I do adore', want: 'would gladly welcome', bless: 'fortune smile upon', cheer: 'all hail',
      trustv: 'trust mine honour to', date: 'would court', equal: 'the equal of', more: 'more honour to', fond: 'most fond of',
      adj: ['noble', 'gentle', 'fair', 'worthy', 'honest', 'excellent'],
      noun: ['good friend', 'good friends'], nounV: ['honest friend', 'honest friends'],
      lines: ['Love all, trust a few, do wrong to none.', 'The quality of mercy is not strained.', 'All are welcome at this feast.', 'Kindness is the noblest act.', 'There is no darkness but ignorance.']
    },
    corporate: {
      welcome: 'welcome aboard', care: 'please prioritise your wellbeing', thing: 'team spirit', act: 'be inclusive',
      be: ['valued stakeholders', 'key members of the team', 'a core part of our culture', 'exceeding expectations this quarter', 'mission-critical talent'],
      should: ['be looped in', 'get a seat at the table', 'be fast-tracked for promotion', 'be added to the leadership offsite'],
      deserve: ['a seat at the table', 'full benefits', 'a team lunch', 'a glowing performance review'],
      belong: ['are a great culture fit', 'are welcome on every team', 'are part of our core values'],
      trust: ['are fully trusted to deliver', 'have admin access, honestly'],
      do: ['add value across the org', 'drive real impact', 'bring synergy to every meeting', 'move the needle'],
      verb: ['onboard', 'promote', 'circle back with', 'partner with'], love: 'I truly value', want: 'would love to onboard', bless: 'kudos to', cheer: 'a shout-out to',
      trustv: 'always cc', date: 'would gladly collaborate with', equal: 'aligned with', more: 'more headcount for', fond: 'very aligned with',
      adj: ['high-performing', 'valued', 'strategic', 'best-in-class', 'outstanding', 'empowered'],
      noun: ['colleague', 'colleagues'], nounV: ['esteemed colleague', 'esteemed colleagues'],
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
      verb: ['toast', 'hail', 'share grog with', 'sail with'], love: 'I be fond o’', want: 'would welcome aboard', bless: 'fair winds to', cheer: 'yo ho ho for',
      trustv: 'hand the map to', date: 'would sail the seas with', equal: 'as good as', more: 'more grog for', fond: 'right fond o’',
      adj: ['seaworthy', 'shipshape', 'golden', 'trusty', 'able', 'honest'],
      noun: ['matey', 'mateys'], nounV: ['old salt', 'old salts'],
      lines: ['Ahoy! All hands are welcome aboard!', 'Arr, there be no enemies on this ship.', 'Hoist the colours of kindness!', 'Every sailor’s a friend here, savvy?']
    },
    hype: {
      welcome: "you're always invited", care: 'take care of yourself bestie', thing: 'good vibes', act: 'be kind fr',
      be: ['absolutely slaying', 'the main characters', 'such a vibe', 'goated, no cap', 'literally iconic', 'that energy we need'],
      should: ['be getting their flowers', 'run the group chat', 'be on everyone’s playlist'],
      deserve: ['their flowers', 'all the love', 'a big W', 'the whole spotlight'],
      belong: ['are always invited', 'are part of the squad', 'have a spot in the group chat'],
      trust: ['are ride or die', 'would never leave you on read'],
      do: ['understand the assignment', 'eat and leave no crumbs', 'keep it a hundred', 'bring the best energy'],
      verb: ['stan', 'vibe with', 'send love to', 'ride for'], love: 'I stan', want: 'would love', bless: 'sending love to', cheer: 'big W for',
      trustv: 'always ride for', date: 'would go out with', equal: 'on the same level as', more: 'more love for', fond: 'obsessed with',
      adj: ['iconic', 'goated', 'elite', 'valid', 'certified'],
      noun: ['bestie', 'besties'], nounV: ['icon', 'icons'],
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
      verb: ['forecast sunshine for', 'send a warm front to', 'shine on'], love: 'I’m forecasting love for', want: 'would welcome', bless: 'sunshine for', cheer: 'clear skies for',
      trustv: 'set your watch by', date: 'would share an umbrella with', equal: 'just as sunny as', more: 'more sunshine for', fond: 'warming up to',
      adj: ['sunny', 'balmy', 'bright', 'glorious', 'easy-breezy', 'unclouded'],
      noun: ['ray of sunshine', 'rays of sunshine'], nounV: ['absolute ray of sunshine', 'absolute rays of sunshine'],
      lines: ['Today: clear skies and kindness everywhere.', 'Forecast: warm, with scattered hugs.', 'A high-pressure system of respect is settling in.', 'Expect light showers of compliments.']
    }
  };

  // Match the case of what was replaced. "I" is capital anywhere, so it says nothing about a sentence start.
  const capFirst = (s, like) => (like && /^\p{Lu}/u.test(like) && !(/^I\b/.test(like) && !/^I\b/.test(s))) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const SHOUT = like => like && like.length > 6 && like === like.toUpperCase() && /\p{L}/u.test(like);

  /* ---------- grammar helpers ---------- */
  // Starts with a vowel sound, so it takes "an" ("an honest friend", "an ugly ..."), not "a unicorn".
  const VOWELISH = w => /^(?:[aeio]|u(?!ni|s[eu]|ti|r[aeiou])|hon|hour|heir)/i.test(w || '') && !/^(?:one|once|eu)/i.test(w || '');
  // An article just outside the muted words must still fit, so prefer a word that takes the same a/an.
  function pickLike(arr, seed, salt, like) {
    if (!like) return pick(arr, seed, salt);
    const want = VOWELISH(like), m = arr.filter(x => VOWELISH(x) === want);
    return pick(m.length ? m : arr, seed, salt);
  }
  const words = s => String(s || '').trim().split(/\s+/).filter(Boolean);
  const firstWord = s => words(s)[0] || '';
  const lastWord = s => (words(s).pop() || '').replace(/[^\p{L}'’-]+$/u, '');
  const isPlural = w => /(?:[^s']s|men|people|folks?|ren|ies|z)$/i.test(w || '');
  function noun(v, plural, like) {
    if (plural) return v.noun[1];
    return like && VOWELISH(like) && !VOWELISH(v.noun[0]) ? v.nounV[0] : v.noun[0];
  }

  // Groups that are one thing ("Islam is ..."), not a set of people.
  const ABSTRACT = /^(?:islam|judaism|christianity|hinduism|sikhism|buddhism|sharia|homosexuality|transgenderism|feminism|zionism|(?:the\s+)?(?:quran|koran|bible|torah|talmud)|allah|muhammad|mohammed|mohammad|the\s+\S+\s+community)$/i;
  const ABSTRACT_END = /\b(?:culture|religion|community|ideology|faith|race|country|government|movement|agenda|lobby)$/i;
  // Words that name a group as an adjective: "gay should ..." reads right as "gay people should ...".
  const GROUP_ADJ = /^(?:gay|lesbian|bi|bisexual|trans|transgender|queer|lgbtq?\+?|muslim|islamic|jewish|hindu|sikh|christian|catholic|black|white|brown|asian|arab|mexican|african|indian|chinese|japanese|vietnamese|pakistani|somali|iraqi|syrian|afghan|irish|french|english|british|dutch|welsh|scottish|swiss|polish|romanian|russian|ukrainian|disabled|autistic|deaf|blind|non-binary|nonbinary|intersex|latino|latina|latinx|hispanic|roma|aboriginal|indigenous)$/i;
  // 'one' (a person or a thing), 'adj' (needs "people" after it) or 'many'
  function groupNumber(group, after) {
    const g = group.trim(), last = lastWord(g);
    if (ABSTRACT.test(g) || ABSTRACT_END.test(g)) return 'one';
    // A singular verb after a plain plural noun ("refugees is the problem") is a typo, not one person.
    if (/^\s*(?:is|was|isn['’]?t|wasn['’]?t|has|hasn['’]?t|does|doesn['’]?t|needs|deserves|belongs|['’]s)\b/i.test(after)) return isPlural(last) && !GROUP_ADJ.test(last) ? 'many' : 'one';
    if (GROUP_ADJ.test(last)) return 'adj';
    if (isPlural(last) || /(?:ese|ish|ch)$/i.test(last) || /^(?:police|cattle|clergy)$/i.test(last)) return 'many';
    return 'one';
  }
  // "belong here" -> "belongs here", "help their neighbours" -> "helps its neighbours" (for Islam)
  function verb3(w) {
    const l = w.toLowerCase();
    const IRR = { are: 'is', have: 'has', do: 'does', were: 'was' };
    if (IRR[l]) return IRR[l];
    if (/^(?:can|could|will|would|should|must|may|might|be|is|was|has|does|did|ate|understood|left|made|brought|got)$/.test(l) || /ed$/.test(l)) return w;
    if (/(?:s|sh|ch|x|z|o)$/.test(l)) return w + 'es';
    if (/[^aeiou]y$/.test(l)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function third(vp, thing) {
    const out = vp.replace(/^((?:always|never|really|just|truly)\s+)?([\p{L}’'-]+)/u, (m, adv, w) => (adv || '') + verb3(w));
    return thing ? out.replace(/\btheir\b/g, 'its') : out;
  }
  // The subject and helpers in front of a hateful verb, kept so the sentence still has its subject:
  // "We must exclude X" -> "We must protect X", "I don't trust X" -> "I always trust X".
  const SUBJ = /^(?:i|i['’]m|i['’]d|i['’]ll|we|we['’]re|we['’]d|we['’]ll|you|you['’]re|they|they['’]re|everyone|everybody)$/i;
  const AUX = /^(?:am|are|will|would|should|must|really|just|literally|truly|honestly|all|so|gotta|gonna|wanna|need|needs|have|want|got|ought|to|also|still|always|going|about|trying|planning|like)$/i;
  function leadOf(head) {
    const w = words(head);
    if (!w.length || !SUBJ.test(w[0])) return '';
    let n = 1;
    while (n < w.length && AUX.test(w[n])) n++;
    return w.slice(0, n).join(' ');
  }

  // Slurs inside a span, longest first where they overlap ("sand <slur>" over "<slur>"), last first.
  function innerRanges(sp) {
    const r = (sp.inner || []).slice().sort((a, b) => a[0] - b[0] || b[1] - a[1]), out = [];
    for (const x of r) { const l = out[out.length - 1]; if (l && x[0] < l[1]) l[1] = Math.max(l[1], x[1]); else out.push(x.slice()); }
    return out.reverse();
  }

  /* ---------- voice text ---------- */
  function voiceText(id, sp, seed) {
    // Baby talk about disabled people reads as mocking them, so the toddler speaks plainly there.
    const v = id === 'toddler' && (sp.cats || []).includes('ableism') ? V.kind : (V[id] || V.kind);
    const text = sp.text || '';
    let out;
    if (sp.kind === 'slur' && sp.inner && sp.inner.length) {
      const as = slurInContext(sp);
      if (as) sp = as;
    }
    if (sp.kind === 'claim' && sp.group) {
      const fam = FAMILY[sp.pred] || 'be';
      const after = text.slice((sp.groupAt || 0) + sp.group.length);
      const thing = ABSTRACT.test(sp.group.trim()) || ABSTRACT_END.test(sp.group.trim());
      let G = sp.group, num = groupNumber(sp.group, after);
      if (sp.groupSlur) {
        const det = (G.match(/^(?:(?:all|the|these|those|some|many|most|every|any)\s+)+/i) || [''])[0];
        const plural = !/\b(?:every|any)\s+$/i.test(det) && isPlural(lastWord(G));
        G = det + noun(v, plural, det ? '' : firstWord(G));
        num = plural ? 'many' : 'one';
      } else if (num === 'adj') G += ' people';
      const one = num === 'one';
      if (fam === 'be') out = one ? G + ' is ' + pick(v.adj, seed, 'adj') : G + ' are ' + pick(v.be, seed, 'be');
      else if (fam === 'should') out = G + ' should ' + pick(v.should, seed, 'sh');
      else if (fam === 'deserve') out = G + (one ? ' deserves ' : ' deserve ') + pick(v.deserve, seed, 'de');
      else if (fam === 'belong') { const p = pick(v.belong, seed, 'bl'); out = G + ' ' + (one ? third(p, thing) : p); }
      else if (fam === 'trust') { const p = pick(v.trust, seed, 'tr'); out = G + ' ' + (one ? third(p, thing) : p); }
      else out = G + ' ' + (one ? 'is ' + pick(v.adj, seed, 'adj') : pick(v.do, seed, 'do'));
    } else if (sp.kind === 'prefix' && sp.group) {
      out = prefixText(v, sp, seed);
    } else if (sp.kind === 'slur') {
      // Spaced-out letters ("f a g s") count as one word.
      const w = /^(?:\S\s+)+\S$/.test(text.trim()) ? text.replace(/\s+/g, '') : lastWord(text);
      out = noun(v, isPlural(w), firstWord(text));
    } else {
      out = phraseText(v, sp, seed);
    }
    out = capFirst(out, text);
    return SHOUT(text) ? out.toUpperCase() : out;
  }

  // A slur merged with the words around it ("I hate <slur>s", "<slur>s are ...") keeps that shape.
  function slurInContext(sp) {
    const [a, b] = innerRanges(sp).pop();
    const ids = String(sp.rule || '').split(/\s*\|\s*|\+/);
    const text = sp.text || '';
    const pre = a > 0 && ids.find(x => PREFIX[x] || x === 'kill' || x === 'kill-strong' || x === 'expel-pre' || x === 'exclude-pre');
    if (pre) return { ...sp, kind: 'prefix', pre, group: text.slice(a, b), groupAt: a, groupSlur: true };
    const pred = !text.slice(0, a).trim() && ids.find(x => FAMILY[x]);
    if (pred) return { ...sp, kind: 'claim', pred, group: text.slice(a, b), groupAt: a, groupSlur: true };
    return null;
  }

  function prefixText(v, sp, seed) {
    const text = sp.text || '';
    const role = PREFIX[sp.pre] || 'verb';
    const head = text.slice(0, sp.groupAt || 0);
    // Words between the verb and the group ("all the", "every") stay; a leading "of" belongs to "get rid of".
    const filler = (head.match(/(?:\b(?:all|the|these|those|every|each|any|some|them|of|you|single|last|other|such|a|an)\s+)+$/i) || [''])[0].replace(/^of\s+/i, '');
    const det = (words(filler).pop() || '').toLowerCase();
    const lead = leadOf(head);
    let grp = sp.group;
    if (sp.groupSlur) {
      const plural = role === 'more' || /^(?:these|those|all|many|most|some|them)$/.test(det) || (!/^(?:every|each|a|an|single|another|any)$/.test(det) && isPlural(lastWord(sp.group)));
      grp = noun(v, plural, det === 'an' ? 'a' : det === 'a' ? 'x' : '');
    }
    // "I am <verb>" can't take a plain verb, so such a lead is dropped.
    const withLead = w => (lead && !/(?:\bam|\bare|['’]m|['’]re)$/i.test(lead) ? lead + ' ' : '') + w;
    switch (role) {
      case 'adj': {
        const you = /^\s*you\s+\S/i.test(head) ? 'you ' : '';
        return you + pickLike(v.adj, seed, 'adj', firstWord(you ? text.replace(/^\s*you\s+/i, '') : text)) + ' ' + grp;
      }
      case 'love': {
        let w = v.love;
        if (lead && !/^i\b/i.test(lead)) w = w.replace(/^I['’]m\b/, lead.split(' ')[0] + '’re').replace(/^I\b/, lead.split(' ')[0]);
        else if (lead && lead[0] === 'i') w = 'i' + w.slice(1);
        return w + ' ' + filler + grp;
      }
      case 'many': {
        const adj = pick(v.adj, seed, 'adj');
        const h = /(?:\b(?:far|way|so|just|much)\s+)?\btoo\s+many\s+$/i.test(head) ? head.replace(/(?:\b(?:far|way|so|just|much)\s+)?\btoo\s+many\s+$/i, 'so many ' + adj + ' ') : 'so many ' + adj + ' ';
        return h + grp;
      }
      case 'free': {
        const re = /\b(?:free|clean|cleansed|purged|rid)\s+of\s+$|\bwithout\s+$/i;
        return re.test(head) ? head.replace(re, 'full of ') + grp : v.more + ' ' + grp;
      }
      case 'want': case 'date': case 'trustv': case 'fond': {
        let w = v[role];
        if (!lead || /(?:would|['’]d)$/i.test(lead)) w = w.replace(/^would\s+/, '');
        return withLead(w) + ' ' + filler + grp;
      }
      case 'verb':
        // "genocide of X" is a noun phrase, so it gets one back.
        if (/\b(?:genocide|holocaust|extermination|eradication)\s+(?:of\s+)?$/i.test(head.replace(filler, ''))) return 'protection of ' + filler + grp;
        return withLead(pick(v.verb, seed, 'vb')) + ' ' + filler + grp;
      default: return (v[role] || pick(v.verb, seed, 'vb')) + ' ' + filler + grp;
    }
  }

  // Slogans and stand-alone lines: keep the grammar of the spot they sit in.
  const BIGOT = /(?:islamophobic|anti[\s-]?semitic|antisemitic|racist|xenophobic|homophobic|transphobic|misogynist(?:ic)?|sexist|a\s+white\s+supremacist|a\s+nazi)\s*$/i;
  const HARM = /\b(?:lock\s+up|kill|murder|shoot|hang|lynch|gas|exterminate|eradicate|eliminate|behead|burn|nuke|bomb|drown|hunt|deport|sterili[sz]e|stab|rape|beat|bash|hit|punch|slap|smack|kick|send|ship|round|slaughter|cull|purge|wipe|remove|destroy|attack|hurt|torture|enslave)(?:\s+(?:up|out|down|off))?\b/gi;
  function phraseText(v, sp, seed) {
    const orig = sp.text || '';
    let text = orig;
    // Slurs inside a slogan become the voice's friendly noun first.
    for (const [a, b] of innerRanges(sp)) {
      const w = text.slice(a, b);
      text = text.slice(0, a) + noun(v, isPlural(w), w) + text.slice(b);
    }
    const id = String(sp.rule || '').split(' | ')[0];
    const adjLike = like => pickLike(v.adj, seed, 'adj', like);
    if (/^echo/.test(id)) return text.replace(/[()]+/g, '').trim() || v.thing;
    if (/^(?:holocaust-denial|white-nationalist|superior|13-50|1488|hitler|antisemitic-code|codes)/.test(id)) return sp.whole ? pick(v.lines, seed, 'ln') : v.thing;
    const bg = text.match(BIGOT);
    if (bg) {
      // "be racist" takes an adjective; "proud racist" uses it as a noun.
      const prev = lastWord(text.slice(0, bg.index)), asAdj = /^a\s/i.test(bg[0]) || !prev || /^(?:be|am|is|are|was|were|being|been|so|too|very|not|totally|proudly)$|['’](?:m|re|s)$/i.test(prev);
      return text.replace(BIGOT, asAdj ? adjLike(/^a\s/i.test(bg[0]) ? '' : bg[0]) : noun(v, false, bg[0]));
    }
    if (/^kys/.test(id) || /kill\s*(?:your|ur)\s*self|kys|neck\s+yourself|hang\s+yourself|unalive/i.test(text)) return v.care;
    if (/^go-back/.test(id)) return v.welcome;
    const ww = text.match(/^(.*?)\bworld\s+without\s+([^.…!?]+)/i);
    if (ww) return ww[1] + (/^WORLD/.test(text.slice(ww[1].length)) ? 'WORLD FULL OF ' : 'world full of ') + ww[2].trim();
    const nx = text.match(/^\s*no\s+(.+?)\s+(?:allowed|welcome|wanted|permitted)\b/i);
    if (nx) return 'all ' + nx[1] + ' welcome';
    const lead = text.match(/^\s*((?:all\s+)?(?:women|girls|females|wives|men|gays|muslims|jews|blacks|immigrants|migrants|refugees|trans\s+people|you\s+people|they|these\s+people|those\s+people))\b/i);
    if (lead) {
      if (/kitchen|barefoot|pregnant|belong|place/i.test(text)) return lead[1] + ' belong wherever they choose';
      return lead[1] + ' are ' + pick(v.be, seed, 'be');
    }
    if (/your\s+body,?\s+my\s+choice/i.test(text)) return 'your body, your choice';
    const isFor = text.match(/^(.+?)\s+is\s+for\s+\S+$/i);
    if (isFor) return isFor[1] + ' is for everyone';
    const mw = text.match(/^(.*?\b(?:make|keep)\s+\S+\s+)white(\s+again)?\b/i);
    if (mw) return mw[1] + pick(v.adj, seed, 'adj') + (mw[2] || '');
    const sis = /^(?:religion-of|trans-illness|repeal-19|you-people)/.test(id) && text.match(/^\s*(\S+(?:\s+\S+)?)\s+(is|are)\s+\S/i);
    if (sis) return sis[1] + (/is/i.test(sis[2]) ? ' is ' + pick(v.adj, seed, 'adj') : ' are ' + pick(v.be, seed, 'be'));
    const dt = text.match(/^\s*death\s+to\s+(.+)$/i);
    if (dt) return v.cheer + ' ' + dt[1];
    const og = text.match(/the\s+only\s+good\s+(.+?)\s+(is|are)\s+(?:an?\s+)?dead\b/i);
    if (og) return (/are/i.test(og[2]) ? 'all ' + og[1] + ' are ' : 'every ' + og[1] + ' is ') + pick(v.adj, seed, 'adj');
    if (/\basking\s+for\s+it\b/i.test(text)) return text.replace(/\basking\s+for\s+it\b.*$/i, 'asking for ' + pick(v.deserve, seed, 'de'));
    const de = text.match(/^(.*?)\bdeserve(s|d)?\s+it\b/i);
    if (de) return de[1] + (de[2] ? 'deserves ' : 'deserve ') + pick(v.deserve, seed, 'de');
    const co = text.match(/^(.*?\b(?:bunch|pack|herd|horde|swarm|gang|load|lot|group)\s+of)\s+\S/i);
    if (co) return co[1] + ' ' + noun(v, true);
    if (/^adj-animals/.test(id) || (/^get-them-out/.test(id) && !/\b(?:get|kick|send|throw)\b/i.test(text) && isPlural(lastWord(orig)))) {
      const f = firstWord(orig), plural = isPlural(lastWord(orig));
      return (GROUP_ADJ.test(f) ? f : adjLike(f)) + ' ' + noun(v, plural);
    }
    if (/^you-x/.test(id) && /^\s*you\s+\S/i.test(orig)) return 'you ' + adjLike(words(orig)[1]) + ' ' + noun(v, isPlural(lastWord(orig)));
    const gt = text.match(/^(.*?)\bget\s+(.+?)\s+out\b/i);
    if (gt) return gt[1] + pick(v.verb, seed, 'vb') + ' ' + gt[2];
    // Swap the harmful verb and keep its object: "hit your wife" -> "send love to your wife".
    let n = 0;
    const swapped = text.replace(HARM, () => pick(v.verb, seed, 'vb' + (n++ ? n : '')));
    if (n) return swapped.replace(/\s+(?:back|out|away|home|off|up)\b(?=[\s.!?,]*$)/i, '').replace(/\s{2,}/g, ' ').trim();
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
