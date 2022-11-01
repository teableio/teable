import type { Prisma } from '@prisma/client';
import keywordExtractor from 'keyword-extractor';
import { slugify } from 'transliteration';

/* eslint-disable sonarjs/no-duplicate-string */

// Taken from https://medium.com/@EmEmbarty/31-of-the-best-and-most-famous-short-classic-poems-of-all-time-e445986e6df

const poems = [
  {
    author: 'John Donne',
    title: 'No man is an island',
    content: `
      No man is an island,
      Entire of itself,
      Every man is a piece of the continent,
      A part of the main.
      If a clod be washed away by the sea,
      Europe is the less.
      As well as if a promontory were.
      As well as if a manor of thy friend’s
      Or of thine own were:
      Any man’s death diminishes me,
      Because I am involved in mankind,
      And therefore never send to know for whom the bell tolls;
      It tolls for thee.
    `,
  },
  {
    author: 'Robert Frost',
    title: 'Stopping by Woods On a Snowy Evening',
    content: `
      Whose woods these are I think I know.
      His house is in the village though;
      He will not see me stopping here
      To watch his woods fill up with snow.
      My little horse must think it queer
      To stop without a farmhouse near
      Between the woods and frozen lake
      The darkest evening of the year.
      He gives his harness bells a shake
      To ask if there is some mistake.
      The only other sound’s the sweep
      Of easy wind and downy flake.
      The woods are lovely, dark and deep,
      But I have promises to keep,
      And miles to go before I sleep,
      And miles to go before I sleep.
    `,
  },
  {
    author: 'Maya Angelou',
    title: 'Still I rise',
    content: `
      You may write me down in history
      With your bitter, twisted lies,
      You may tread me in the very dirt
      But still, like dust, I’ll rise.
      Does my sassiness upset you?
      Why are you beset with gloom?
      ’Cause I walk like I’ve got oil wells
      Pumping in my living room.
      Just like moons and like suns,
      With the certainty of tides,
      Just like hopes springing high,
      Still I’ll rise.
      Did you want to see me broken?
      Bowed head and lowered eyes?
      Shoulders falling down like teardrops.
      Weakened by my soulful cries.
      Does my haughtiness offend you?
      Don’t you take it awful hard
      ’Cause I laugh like I’ve got gold mines
      Diggin’ in my own back yard.
      You may shoot me with your words,
      You may cut me with your eyes,
      You may kill me with your hatefulness,
      But still, like air, I’ll rise.
      Does my sexiness upset you?
      Does it come as a surprise
      That I dance like I’ve got diamonds
      At the meeting of my thighs?
      Out of the huts of history’s shame
      I rise
      Up from a past that’s rooted in pain
      I rise
      I’m a black ocean, leaping and wide,
      Welling and swelling I bear in the tide.
      Leaving behind nights of terror and fear
      I rise
      Into a daybreak that’s wondrously clear
      I rise
      Bringing the gifts that my ancestors gave,
      I am the dream and the hope of the slave.
      I rise
      I rise
      I rise.
    `,
  },
  {
    author: 'William Shakespeare',
    title: `Shall I Compare Thee To A Summer's Day?`,
    content: `
      Shall I compare thee to a summer’s day?
      Thou art more lovely and more temperate.
      Rough winds do shake the darling buds of May,
      And summer’s lease hath all too short a date.
      Sometime too hot the eye of heaven shines,
      And often is his gold complexion dimmed;
      And every fair from fair sometime declines,
      By chance, or nature’s changing course, untrimmed;
      But thy eternal summer shall not fade,
      Nor lose possession of that fair thou ow’st,
      Nor shall death brag thou wand’rest in his shade,
      When in eternal lines to Time thou grow’st.
      So long as men can breathe, or eyes can see,
      So long lives this, and this gives life to thee.
    `,
  },
  {
    author: 'Sara Teasdale',
    title: `There Will Come Soft Rain`,
    content: `
      There will come soft rain and the smell of the ground,
      And swallows circling with their shimmering sound;
      And frogs in the pools singing at night,
      And wild plum trees in tremulous white;
      Robins will wear their feathery fire,
      Whistling their whims on a low fence-wire;
      And not one will know of the war, not one
      Will care at last when it is done.
      Not one would mind, neither bird nor tree,
      If mankind perished utterly;
      And Spring herself, when she woke at dawn
      Would scarcely know that we were gone.
    `,
  },
  {
    author: 'Pablo Neruda',
    title: `If You Forget Me`,
    content: `
      I want you to know
      one thing.
      You know how this is:
      if I look
      at the crystal moon, at the red branch
      of the slow autumn at my window,
      if I touch
      near the fire
      the impalpable ash
      or the wrinkled body of the log,
      everything carries me to you,
      as if everything that exists,
      aromas, light, metals,
      were little boats
      that sail
      toward those isles of yours that wait for me.
      Well, now,
      if little by little you stop loving me
      I shall stop loving you little by little.
      If suddenly
      you forget me
      do not look for me,
      for I shall already have forgotten you.
      If you think it long and mad,
      the wind of banners
      that passes through my life,
      and you decide
      to leave me at the shore
      of the heart where I have roots,
      remember
      that on that day,
      at that hour,
      I shall lift my arms
      and my roots will set off
      to seek another land.
      But
      if each day,
      each hour,
      you feel that you are destined for me
      with implacable sweetness,
      if each day a flower
      climbs up to your lips to seek me,
      ah my love, ah my own,
      in me all that fire is repeated,
      in me nothing is extinguished or forgotten,
      my love feeds on your love, beloved,
      and as long as you live it will be in your arms
      without leaving mine.
    `,
  },
  {
    author: 'Robert Frost',
    title: `Fire And Ice`,
    content: `
      Some say the world will end in fire,
      Some say in ice.
      From what I’ve tasted of desire
      I hold with those who favor fire.
      But if it had to perish twice,
      I think I know enough of hate
      To say that for destruction ice
      Is also great
      And would suffice.
    `,
  },
  {
    author: 'Robert Frost',
    title: `The Road Not Taken`,
    content: `
      Two roads diverged in a yellow wood,
      And sorry I could not travel both
      And be one traveler, long I stood
      And looked down one as far as I could
      To where it bent in the undergrowth;
      Then took the other, as just as fair,
      And having perhaps the better claim
      Because it was grassy and wanted wear,
      Though as for that the passing there
      Had worn them really about the same,
      And both that morning equally lay
      In leaves no step had trodden black.
      Oh, I kept the first for another day!
      Yet knowing how way leads on to way
      I doubted if I should ever come back.
      I shall be telling this with a sigh
      Somewhere ages and ages hence:
      Two roads diverged in a wood, and I,
      I took the one less traveled by,
      And that has made all the difference.
    `,
  },
  {
    author: 'Langston Hughes',
    title: `Dreams`,
    content: `
      Hold fast to dreams
      For if dreams die
      Life is a broken-winged bird
      That cannot fly.
      Hold fast to dreams
      For when dreams go
      Life is a barren field
      Frozen with snow.
    `,
  },
  {
    author: 'Joyce Kilmer',
    title: `Trees`,
    content: `
      I think that I shall never see
      A poem lovely as a tree.
      A tree whose hungry mouth is prest
      Against the earth’s sweet flowing breast;
      A tree that looks at God all day,
      And lifts her leafy arms to pray;
      A tree that may in summer wear
      A nest of robins in her hair;
      Upon whose bosom snow has lain;
      Who intimately lives with rain.
      Poems are made by fools like me,
      But only God can make a tree.
    `,
  },
].map((poem) => {
  const sanitizedContent = poem.content
    // @link http://www.unicode.org/reports/tr18/#RL1.6
    .split(/(\r\n|[\n\v\f\r\x85\u2028\u2029])/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
  return {
    ...poem,
    slug: slugify(`${poem.author}-${poem.title}`),
    content: sanitizedContent,
  };
});

export const poemsSeed: Prisma.PoemCreateInput[] = poems.map((poem) => {
  const keywords = keywordExtractor.extract(poem.title, {
    language: 'english',
    remove_digits: true,
    return_changed_case: true,
    remove_duplicates: true,
  });
  const poemInput: Prisma.PoemCreateInput = {
    ...poem,
    keywords: {
      create: keywords.map((keyword) => ({
        keyword: {
          connectOrCreate: {
            create: { name: keyword },
            where: { name: keyword },
          },
        },
      })),
    },
  };
  return poemInput;
});
