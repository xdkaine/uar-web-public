import { randomBytes } from 'crypto';

const COMMON_PASSWORDS = [
  'password', 'password123', '123456', '12345678', 'qwerty', 'abc123',
  'monkey', '1234567', 'letmein', 'trustno1', 'dragon', 'baseball',
  'iloveyou', 'master', 'sunshine', 'ashley', 'bailey', 'shadow',
  'superman', 'qwerty123', 'welcome', 'admin', 'password1'
];

// Word list for passphrase generation (4-8 letter words)
const WORD_LIST = [
  'ability', 'above', 'accept', 'active', 'actor', 'admin', 'advice', 'after',
  'agency', 'agent', 'agree', 'ahead', 'alarm', 'allow', 'almost', 'alone',
  'along', 'always', 'amount', 'anger', 'animal', 'answer', 'anyone', 'apply',
  'argue', 'arise', 'array', 'arrive', 'article', 'artist', 'assert', 'assess',
  'assume', 'attach', 'attack', 'attempt', 'attend', 'author', 'avoid', 'award',
  'aware', 'balance', 'basket', 'battle', 'beauty', 'become', 'before', 'begin',
  'behave', 'behind', 'belief', 'belong', 'benefit', 'better', 'beyond', 'binary',
  'bishop', 'block', 'board', 'bottle', 'bottom', 'branch', 'brave', 'bread',
  'break', 'bridge', 'brief', 'bright', 'bring', 'broken', 'brother', 'budget',
  'build', 'burden', 'button', 'camera', 'cancel', 'cancer', 'candle', 'canvas',
  'capable', 'capital', 'carbon', 'career', 'carpet', 'castle', 'casual', 'catch',
  'center', 'chain', 'chair', 'chance', 'change', 'charge', 'chase', 'cheap',
  'check', 'cherry', 'choice', 'choose', 'church', 'circle', 'claim', 'clean',
  'clear', 'click', 'client', 'climate', 'climb', 'clock', 'close', 'cloud',
  'coach', 'coffee', 'collect', 'color', 'column', 'combat', 'combine', 'comfort',
  'coming', 'commit', 'common', 'compare', 'compete', 'complex', 'concept', 'concern',
  'concert', 'conduct', 'confirm', 'conflict', 'connect', 'consider', 'consist', 'constant',
  'consume', 'contact', 'contain', 'content', 'contest', 'context', 'continue', 'contract',
  'control', 'convert', 'copper', 'corner', 'correct', 'cosmic', 'cotton', 'council',
  'count', 'country', 'couple', 'courage', 'course', 'cover', 'craft', 'crash',
  'crazy', 'create', 'credit', 'crime', 'crisis', 'critic', 'cross', 'crowd',
  'crown', 'crystal', 'culture', 'cursor', 'custom', 'damage', 'danger', 'debate',
  'decade', 'decide', 'declare', 'decline', 'decor', 'defeat', 'defend', 'define',
  'degree', 'delay', 'delete', 'deliver', 'demand', 'depend', 'deploy', 'depth',
  'derive', 'describe', 'desert', 'deserve', 'design', 'desire', 'detail', 'detect',
  'device', 'devote', 'dialog', 'diamond', 'differ', 'digital', 'dinner', 'direct',
  'discover', 'discuss', 'disease', 'display', 'dispose', 'dispute', 'distance', 'distant',
  'district', 'divide', 'divine', 'doctor', 'document', 'domain', 'double', 'dragon',
  'drama', 'dream', 'drive', 'driver', 'eagle', 'early', 'earth', 'easily',
  'eastern', 'economy', 'editor', 'effect', 'effort', 'either', 'elect', 'element',
  'elite', 'emerge', 'emotion', 'empire', 'employ', 'enable', 'energy', 'engage',
  'engine', 'enhance', 'enjoy', 'enough', 'ensure', 'enter', 'entire', 'entity',
  'entry', 'equal', 'equity', 'error', 'escape', 'essay', 'estate', 'estimate',
  'ethnic', 'event', 'every', 'evidence', 'evolve', 'exact', 'example', 'exceed',
  'except', 'excess', 'exchange', 'excite', 'exclude', 'excuse', 'execute', 'exercise',
  'exhibit', 'exist', 'exit', 'expand', 'expect', 'expense', 'expert', 'explain',
  'explode', 'explore', 'export', 'expose', 'express', 'extend', 'extent', 'extra',
  'extreme', 'fabric', 'factor', 'factory', 'faculty', 'fairly', 'fallen', 'false',
  'family', 'famous', 'fancy', 'fatal', 'father', 'fault', 'favor', 'feature',
  'federal', 'feeling', 'fellow', 'female', 'fence', 'festival', 'fiber', 'field',
  'fifteen', 'figure', 'final', 'finance', 'finger', 'finish', 'flame', 'flash',
  'fleet', 'flight', 'floor', 'flower', 'focus', 'follow', 'force', 'forest',
  'forget', 'formal', 'format', 'former', 'formula', 'fortune', 'forward', 'found',
  'frame', 'freeze', 'french', 'fresh', 'friend', 'frozen', 'fruit', 'function',
  'future', 'galaxy', 'garden', 'gather', 'gender', 'general', 'generate', 'genetic',
  'gentle', 'ghost', 'giant', 'global', 'glory', 'golden', 'grace', 'grade',
  'grain', 'grand', 'grant', 'graph', 'grass', 'grateful', 'gravity', 'great',
  'green', 'ground', 'group', 'growth', 'guard', 'guess', 'guest', 'guide',
  'guilty', 'handle', 'happen', 'happy', 'harbor', 'hardly', 'hardware', 'harmful',
  'harmony', 'health', 'healthy', 'heart', 'heaven', 'heavy', 'height', 'hello',
  'hidden', 'history', 'holder', 'honest', 'honor', 'horizon', 'horror', 'horse',
  'hospital', 'hotel', 'house', 'human', 'hundred', 'hungry', 'hunter', 'hurry',
  'ideal', 'identify', 'identity', 'ignore', 'illegal', 'illness', 'image', 'imagine',
  'impact', 'implement', 'imply', 'import', 'impose', 'improve', 'incident', 'include',
  'income', 'increase', 'indeed', 'index', 'indicate', 'industry', 'infant', 'infect',
  'infer', 'infinite', 'inform', 'initial', 'injure', 'injury', 'inner', 'innocent',
  'input', 'inquiry', 'inside', 'insight', 'insist', 'inspect', 'inspire', 'install',
  'instance', 'instant', 'instead', 'instinct', 'institute', 'instruct', 'instrument', 'insure',
  'intend', 'intense', 'intent', 'interact', 'interest', 'internal', 'interpret', 'interval',
  'interview', 'introduce', 'invade', 'invent', 'invest', 'invite', 'involve', 'island',
  'isolate', 'issue', 'jacket', 'jewel', 'joint', 'journal', 'journey', 'judge',
  'jungle', 'junior', 'justice', 'justify', 'keeper', 'kernel', 'keyboard', 'kingdom',
  'kitchen', 'knight', 'knowledge', 'label', 'labor', 'ladder', 'language', 'laptop',
  'large', 'laser', 'later', 'latest', 'latter', 'launch', 'lawyer', 'layer',
  'leader', 'league', 'learn', 'least', 'leather', 'leave', 'lecture', 'legacy',
  'legal', 'legend', 'lemon', 'length', 'letter', 'level', 'liberty', 'library',
  'license', 'limit', 'linear', 'liquid', 'listen', 'little', 'living', 'local',
  'locate', 'logic', 'lonely', 'lower', 'lucky', 'lunch', 'luxury', 'machine',
  'magic', 'maintain', 'major', 'maker', 'manage', 'manner', 'manual', 'margin',
  'marine', 'market', 'marriage', 'master', 'match', 'material', 'matter', 'maximum',
  'maybe', 'meaning', 'measure', 'mechanic', 'media', 'medical', 'medium', 'meeting',
  'member', 'memory', 'mental', 'mention', 'mentor', 'mercy', 'merely', 'merge',
  'merit', 'message', 'metal', 'meter', 'method', 'middle', 'midnight', 'might',
  'migrate', 'military', 'miller', 'million', 'mineral', 'minimum', 'mining', 'minister',
  'minor', 'minute', 'miracle', 'mirror', 'missing', 'mission', 'mistake', 'mixture',
  'mobile', 'model', 'modern', 'modest', 'modify', 'module', 'moment', 'monitor',
  'month', 'moral', 'motion', 'motor', 'mountain', 'mouse', 'mouth', 'movement',
  'movie', 'muscle', 'museum', 'music', 'mutual', 'mystery', 'narrative', 'narrow',
  'nation', 'native', 'natural', 'nature', 'nearby', 'nearly', 'necessary', 'negative',
  'neglect', 'neighbor', 'neither', 'nephew', 'nerve', 'network', 'neutral', 'never',
  'newly', 'night', 'noble', 'nobody', 'noise', 'normal', 'north', 'notable',
  'notice', 'notion', 'novel', 'nuclear', 'number', 'numerous', 'nurse', 'object',
  'observe', 'obtain', 'obvious', 'occasion', 'occupy', 'occur', 'ocean', 'offer',
  'office', 'officer', 'official', 'often', 'online', 'operate', 'opinion', 'opponent',
  'oppose', 'opposite', 'option', 'orange', 'orbit', 'order', 'ordinary', 'organic',
  'organize', 'origin', 'original', 'other', 'otherwise', 'outcome', 'outdoor', 'outer',
  'outline', 'output', 'outside', 'overall', 'overcome', 'overlap', 'overlook', 'owner',
  'package', 'packet', 'palace', 'panel', 'paper', 'parent', 'parking', 'partial',
  'particle', 'particular', 'partly', 'partner', 'party', 'passage', 'passenger', 'passion',
  'passive', 'pasta', 'patch', 'patent', 'path', 'patient', 'pattern', 'pause',
  'payment', 'peace', 'peak', 'penalty', 'people', 'pepper', 'perceive', 'percent',
  'perfect', 'perform', 'perhaps', 'period', 'permit', 'person', 'persuade', 'phase',
  'phone', 'photo', 'phrase', 'physical', 'piano', 'picture', 'piece', 'pilot',
  'pink', 'pioneer', 'pixel', 'place', 'plain', 'planet', 'plant', 'plastic',
  'plate', 'platform', 'player', 'please', 'pleasure', 'plenty', 'plot', 'pocket',
  'poem', 'point', 'poison', 'police', 'policy', 'political', 'politics', 'poll',
  'pool', 'popular', 'population', 'port', 'portion', 'portrait', 'position', 'positive',
  'possess', 'possible', 'post', 'potato', 'potential', 'pound', 'poverty', 'powder',
  'power', 'practice', 'pray', 'precise', 'predict', 'prefer', 'pregnant', 'premium',
  'prepare', 'present', 'preserve', 'press', 'pressure', 'presume', 'pretty', 'prevent',
  'previous', 'price', 'pride', 'priest', 'primary', 'prime', 'prince', 'principal',
  'principle', 'print', 'prior', 'prison', 'private', 'prize', 'probably', 'problem',
  'proceed', 'process', 'produce', 'product', 'profession', 'professor', 'profile', 'profit',
  'program', 'progress', 'project', 'promise', 'promote', 'prompt', 'proof', 'proper',
  'property', 'proportion', 'proposal', 'propose', 'prosecute', 'prospect', 'protect', 'protein',
  'protest', 'proud', 'prove', 'provide', 'province', 'provision', 'public', 'publish',
  'pull', 'pump', 'punish', 'purchase', 'pure', 'purple', 'purpose', 'pursue',
  'push', 'qualify', 'quality', 'quantity', 'quarter', 'queen', 'question', 'quick',
  'quiet', 'quote', 'race', 'racial', 'radical', 'radio', 'rail', 'rain',
  'raise', 'random', 'range', 'rapid', 'rarely', 'rather', 'ratio', 'rational',
  'reach', 'react', 'reader', 'reading', 'ready', 'real', 'reality', 'realize',
  'really', 'reason', 'recall', 'receive', 'recent', 'recipe', 'recognize', 'recommend',
  'record', 'recover', 'reduce', 'refer', 'reflect', 'reform', 'refuge', 'refuse',
  'regard', 'regime', 'region', 'register', 'regret', 'regular', 'regulate', 'reject',
  'relate', 'relation', 'relative', 'relax', 'release', 'relevant', 'reliable', 'relief',
  'religion', 'rely', 'remain', 'remark', 'remember', 'remind', 'remote', 'remove',
  'render', 'renew', 'repair', 'repeat', 'replace', 'reply', 'report', 'represent',
  'republic', 'request', 'require', 'research', 'resemble', 'reserve', 'reside', 'resign',
  'resist', 'resolve', 'resort', 'resource', 'respect', 'respond', 'response', 'restore',
  'restrict', 'result', 'resume', 'retail', 'retain', 'retire', 'retreat', 'return',
  'reveal', 'revenue', 'reverse', 'review', 'revise', 'revival', 'reward', 'rhythm',
  'rich', 'ride', 'right', 'rigid', 'ring', 'rise', 'risk', 'ritual',
  'rival', 'river', 'road', 'robot', 'rock', 'role', 'roll', 'romantic',
  'roof', 'room', 'root', 'rope', 'rough', 'round', 'route', 'routine',
  'royal', 'rubber', 'rule', 'runner', 'running', 'rural', 'rush', 'sacred',
  'safe', 'safety', 'sail', 'saint', 'sake', 'salary', 'sale', 'salt',
  'same', 'sample', 'sanction', 'sand', 'satellite', 'satisfy', 'sauce', 'save',
  'scale', 'scan', 'scared', 'scenario', 'scene', 'schedule', 'scheme', 'scholar',
  'school', 'science', 'scope', 'score', 'screen', 'script', 'scroll', 'search',
  'season', 'seat', 'second', 'secret', 'section', 'sector', 'secure', 'security',
  'seek', 'seem', 'segment', 'seize', 'select', 'self', 'sell', 'senate',
  'send', 'senior', 'sense', 'sentence', 'separate', 'sequence', 'series', 'serious',
  'serve', 'service', 'session', 'settle', 'setup', 'seven', 'several', 'severe',
  'shadow', 'shake', 'shall', 'shape', 'share', 'sharp', 'sheet', 'shelf',
  'shell', 'shelter', 'shield', 'shift', 'shine', 'ship', 'shirt', 'shock',
  'shoot', 'shop', 'shore', 'short', 'should', 'shoulder', 'shout', 'show',
  'shower', 'shut', 'sibling', 'sick', 'side', 'sight', 'sign', 'signal',
  'signature', 'significant', 'silence', 'silent', 'silicon', 'silver', 'similar', 'simple',
  'simply', 'since', 'sing', 'single', 'sister', 'site', 'situation', 'size',
  'skill', 'skin', 'slave', 'sleep', 'slice', 'slide', 'slight', 'slip',
  'slow', 'small', 'smart', 'smell', 'smile', 'smoke', 'smooth', 'snake',
  'snow', 'social', 'society', 'soft', 'software', 'soil', 'solar', 'soldier',
  'solid', 'solution', 'solve', 'some', 'somehow', 'someone', 'something', 'sometime',
  'somewhat', 'somewhere', 'song', 'soon', 'sophisticated', 'sorry', 'sort', 'soul',
  'sound', 'source', 'south', 'southern', 'space', 'spare', 'speak', 'speaker',
  'special', 'specific', 'speech', 'speed', 'spell', 'spend', 'sphere', 'spin',
  'spirit', 'spiritual', 'split', 'sponsor', 'sport', 'spot', 'spread', 'spring',
  'square', 'squeeze', 'stable', 'staff', 'stage', 'stake', 'stand', 'standard',
  'star', 'stare', 'start', 'state', 'statement', 'station', 'statistics', 'status',
  'stay', 'steady', 'steal', 'steam', 'steel', 'steep', 'steer', 'stem',
  'step', 'stick', 'still', 'stock', 'stomach', 'stone', 'stop', 'storage',
  'store', 'storm', 'story', 'straight', 'strain', 'strange', 'stranger', 'strategic',
  'strategy', 'stream', 'street', 'strength', 'stress', 'stretch', 'strict', 'strike',
  'string', 'strip', 'stroke', 'strong', 'structure', 'struggle', 'student', 'studio',
  'study', 'stuff', 'stupid', 'style', 'subject', 'submit', 'subsequent', 'substance',
  'substantial', 'substitute', 'subtle', 'succeed', 'success', 'such', 'sudden', 'suffer',
  'sufficient', 'sugar', 'suggest', 'suicide', 'suit', 'summer', 'summit', 'super',
  'superior', 'supply', 'support', 'suppose', 'supreme', 'sure', 'surface', 'surgeon',
  'surgery', 'surprise', 'surround', 'survey', 'survival', 'survive', 'survivor', 'suspect',
  'suspend', 'sustain', 'swear', 'sweep', 'sweet', 'swim', 'swing', 'switch',
  'symbol', 'symptom', 'system', 'table', 'tablet', 'tackle', 'tactic', 'tail',
  'take', 'tale', 'talent', 'talk', 'tall', 'tank', 'tape', 'target',
  'task', 'taste', 'teach', 'teacher', 'teaching', 'team', 'tear', 'technical',
  'technique', 'technology', 'teen', 'telephone', 'telescope', 'television', 'tell', 'temple',
  'temporary', 'tempt', 'tend', 'tendency', 'tennis', 'tension', 'tent', 'term',
  'terminal', 'terrible', 'territory', 'terror', 'test', 'text', 'than', 'thank',
  'that', 'theater', 'their', 'them', 'theme', 'themselves', 'then', 'theory',
  'therapy', 'there', 'therefore', 'these', 'they', 'thick', 'thin', 'thing',
  'think', 'third', 'thirsty', 'this', 'thorough', 'those', 'though', 'thought',
  'thousand', 'threat', 'threaten', 'three', 'threshold', 'throat', 'through', 'throughout',
  'throw', 'thumb', 'thus', 'ticket', 'tide', 'tight', 'time', 'timing',
  'tiny', 'tired', 'tissue', 'title', 'today', 'together', 'tomorrow', 'tone',
  'tongue', 'tonight', 'tool', 'tooth', 'topic', 'total', 'touch', 'tough',
  'tour', 'tourist', 'tournament', 'toward', 'tower', 'town', 'toxic', 'trace',
  'track', 'trade', 'tradition', 'traffic', 'tragedy', 'trail', 'train', 'training',
  'transfer', 'transform', 'translate', 'transport', 'trap', 'trash', 'travel', 'treasure',
  'treat', 'treatment', 'treaty', 'tree', 'tremendous', 'trend', 'trial', 'triangle',
  'tribe', 'trick', 'trigger', 'trim', 'trip', 'troop', 'tropical', 'trouble',
  'truck', 'true', 'truly', 'trust', 'truth', 'trying', 'tube', 'tunnel',
  'turn', 'twelve', 'twenty', 'twice', 'twin', 'twist', 'type', 'typical',
  'ugly', 'ultimate', 'unable', 'uncle', 'under', 'undergo', 'understand', 'undertake',
  'unemployed', 'unexpected', 'unfair', 'union', 'unique', 'unit', 'unite', 'unity',
  'universal', 'universe', 'university', 'unknown', 'unless', 'unlike', 'unlikely', 'until',
  'unusual', 'upon', 'upper', 'upset', 'urban', 'urge', 'usage', 'used',
  'useful', 'user', 'usual', 'utility', 'vacation', 'vacuum', 'valid', 'valley',
  'valuable', 'value', 'variable', 'variety', 'various', 'vary', 'vast', 'vehicle',
  'venture', 'version', 'versus', 'vessel', 'veteran', 'victim', 'victory', 'video',
  'view', 'village', 'violate', 'violence', 'violent', 'virtual', 'virtue', 'virus',
  'visible', 'vision', 'visit', 'visitor', 'visual', 'vital', 'vitamin', 'voice',
  'volcano', 'volume', 'volunteer', 'vote', 'wage', 'wait', 'wake', 'walk',
  'wall', 'wander', 'want', 'warm', 'warn', 'warning', 'wash', 'waste',
  'watch', 'water', 'wave', 'weak', 'wealth', 'weapon', 'wear', 'weather',
  'wedding', 'week', 'weekend', 'weight', 'welcome', 'welfare', 'well', 'west',
  'western', 'whale', 'what', 'whatever', 'wheel', 'when', 'whenever', 'where',
  'whereas', 'whether', 'which', 'while', 'whisper', 'white', 'whole', 'whom',
  'whose', 'wide', 'widely', 'widespread', 'wife', 'wild', 'will', 'willing',
  'wind', 'window', 'wine', 'wing', 'winner', 'winter', 'wire', 'wisdom',
  'wise', 'wish', 'with', 'within', 'without', 'witness', 'wolf', 'woman',
  'wonder', 'wood', 'wooden', 'word', 'work', 'worker', 'working', 'workshop',
  'world', 'worried', 'worry', 'worse', 'worst', 'worth', 'would', 'wound',
  'wrap', 'write', 'writer', 'writing', 'wrong', 'yard', 'yeah', 'year',
  'yellow', 'yesterday', 'yield', 'young', 'youth', 'zone'
];

// Special characters for separators and padding
const SEPARATOR_CHARS = '!@$%^&*-_+=:;|~?/.,';
const PADDING_CHARS = '!@$%^&*-_+=:;|~?/.,';
const DIGITS = '0123456789';

/**
 * Securely generates a random integer between min (inclusive) and max (exclusive)
 */
function getRandomInt(min: number, max: number): number {
  const range = max - min;
  const randomValue = randomBytes(4).readUInt32BE(0);
  return min + (randomValue % range);
}

/**
 * Securely selects a random element from an array
 */
function getRandomElement<T>(array: T[]): T {
  const randomIndex = getRandomInt(0, array.length);
  return array[randomIndex];
}

/**
 * Capitalizes the first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generates a user-friendly passphrase-style password
 * Example: FlameReadyVision42$@
 * 
 * Pattern: [Word][Word][Word][Number][Number][SpecialChar][SpecialChar]
 * - Uses 3 random dictionary words (4-8 letters each)
 * - First letter of each word is capitalized
 * - 2 random digits at the end
 * - 2 random special characters at the end
 * 
 * This creates passwords that are:
 * - Easy to remember (real words forming a memorable phrase)
 * - Strong enough for security requirements
 * - Typically 18-28 characters long
 */
export function generateStrongPassword(): string {
  // Select 3 random words
  const word1 = capitalizeFirst(getRandomElement(WORD_LIST));
  const word2 = capitalizeFirst(getRandomElement(WORD_LIST));
  const word3 = capitalizeFirst(getRandomElement(WORD_LIST));
  
  // Generate 2 random digits
  const digit1 = getRandomElement(DIGITS.split(''));
  const digit2 = getRandomElement(DIGITS.split(''));
  
  // Generate 2 random special characters
  const symbol1 = getRandomElement(SEPARATOR_CHARS.split(''));
  const symbol2 = getRandomElement(SEPARATOR_CHARS.split(''));
  
  // Construct the password
  // Pattern: WordWordWordNumberNumberSpecialCharacterSpecialCharacter
  const password = word1 + word2 + word3 + digit1 + digit2 + symbol1 + symbol2;
  
  return password;
}

/**
 * Legacy password generator - kept for backward compatibility
 * Use generateStrongPassword() for new implementations
 */
export interface PasswordOptions {
  length: number;
  includeNumbers: boolean;
  includeSpecialChars: boolean;
}

export function generatePassword(options: PasswordOptions): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  let charset = chars;
  if (options.includeNumbers) charset += numbers;
  if (options.includeSpecialChars) charset += special;
  
  const randomValues = randomBytes(options.length);
  
  let generated = '';
  for (let i = 0; i < options.length; i++) {
    const randomIndex = randomValues[i] % charset.length;
    generated += charset[randomIndex];
  }
  
  if (options.includeNumbers && !/[0-9]/.test(generated)) {
    const randomIndex = randomBytes(1)[0] % numbers.length;
    generated = numbers[randomIndex] + generated.slice(1);
  }
  
  if (options.includeSpecialChars && !/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(generated)) {
    const randomIndex = randomBytes(1)[0] % special.length;
    generated = generated[0] + special[randomIndex] + generated.slice(2);
  }
  
  return generated;
}

export function validatePasswordStrength(password: string): {
  isValid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // LDAP/AD Restrictions
  if (password.includes('\x00')) {
    issues.push('Password cannot contain null characters');
  }

  if (/[\x00-\x1F\x7F]/.test(password)) {
    issues.push('Password cannot contain control characters');
  }

  if (/"{2,}/.test(password)) {
    issues.push('Password cannot contain consecutive quote characters');
  }

  if (password.length < 12) {
    issues.push('Password must be at least 12 characters long');
  }
  
  if (password.length > 128) {
    issues.push('Password must not exceed 128 characters');
  }
  
  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    issues.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    issues.push('Password must contain at least one special character');
  }
  
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
    issues.push('Password is too common. Please choose a stronger password');
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}
