/**
 * The film corpus. Plain ESM, no dependencies, so it loads in Node (ingest,
 * eval) and in the browser under Vite.
 *
 * `title`, `releaseYear` and `content` are the array the brief supplied,
 * unchanged. Two fields are added, and both are additions rather than edits:
 *
 *   poster   The design shows a poster on the result screen and the supplied
 *            data had no images. These are the Wikipedia article images, each
 *            checked to return HTTP 200 with an image content type. They are
 *            still third-party URLs on a host that owes us nothing, so the UI
 *            falls back to a rendered card when one fails to load — see
 *            posterFallback in index.js.
 *
 *   runtimeMinutes
 *            "How much time do you have?" needs a number to compare against,
 *            and the runtime was only ever present inside the prose ("3 hr 10
 *            min"). Parsing it at query time would mean re-parsing nine strings
 *            on every search, and parsing it during ingest would leave the fact
 *            in the database but not in the source. It lives here so the corpus
 *            file remains the whole truth about a film.
 *
 * The runtimes span 101–190 minutes, which is worth knowing before designing
 * around them: there is nothing here under an hour and three quarters, so a
 * short evening returns an empty set unless the filter is allowed to give way.
 * recommend.js handles that rather than pretending the corpus is denser than it
 * is.
 */
export default [
  {
    title: 'Avatar: The Way of the Water',
    releaseYear: '2022',
    runtimeMinutes: 190,
    poster: 'https://upload.wikimedia.org/wikipedia/en/5/54/Avatar_The_Way_of_Water_poster.jpg',
    content:
      "Avatar: The Way of Water (3 hr 10 min): Jake Sully lives with his newfound family formed on the extrasolar moon Pandora. Once a familiar threat returns to finish what was previously started, Jake must work with Neytiri and the army of the Na'vi race to protect their home. Action, Adventure, Fantasy film released in 2022. Directed by James Cameron Written by James Cameron, Rick Jaffa and Amanda Silver. Starring Sam Worthington, Zoe Saldana and Sigourney Weaver. Rated 7.6 on IMDB",
  },
  {
    title: 'The Fabelmans',
    releaseYear: '2022',
    runtimeMinutes: 151,
    poster: 'https://upload.wikimedia.org/wikipedia/en/b/ba/Fabelmansposter.jpeg',
    content:
      'The Fabelmans (2 hr 31 min): Growing up in post-World War II era Arizona, young Sammy Fabelman aspires to become a filmmaker as he reaches adolescence, but soon discovers a shattering family secret and explores how the power of films can help him see the truth. Drama film released in 2022. Directed by Steven Spielberg. Written by Steven Spielberg and Tony Kushner. Starring Michelle Williams, Gabriel LaBelle & Paul Dano. Rated 7.5 on IMDB',
  },
  {
    title: 'Troll',
    releaseYear: '2022',
    runtimeMinutes: 101,
    poster: 'https://upload.wikimedia.org/wikipedia/en/e/ec/Troll_%282022%29.jpeg',
    content:
      'Troll (1 hr 41 min): Deep in the Dovre mountain, something gigantic wakes up after a thousand years in captivity. The creature destroys everything in its path and quickly approaches Oslo. Norwegian action, adventure, drama film released in 2022. Directed by Roar Uthaug. Written by Espen Aukan and Roar Uthaug. Starring Ine Marie Wilmann, Kim Falck and Mads Sjøgård Pettersen. Rated 5.8 on IMDB',
  },
  {
    title: 'Everything Everywhere All at Once',
    releaseYear: '2022',
    runtimeMinutes: 139,
    poster: 'https://upload.wikimedia.org/wikipedia/en/1/1e/Everything_Everywhere_All_at_Once.jpg',
    content:
      'Everything Everywhere All at Once (2 hr 19 min): A middle-aged Chinese immigrant is swept up into an insane adventure in which she alone can save existence by exploring other universes and connecting with the lives she could have led. Action, Adventure, Comedy film released in 2022. Directed by Daniel Kwan and Daniel Scheinert. Written by Daniel Kwan and Daniel Scheinert. Starring: Michelle Yeoh, Stephanie Hsu and Jamie Lee Curtis. Rated 7.8 on IMDB',
  },
  {
    title: 'Oppenheimer',
    releaseYear: '2023',
    runtimeMinutes: 180,
    poster: 'https://upload.wikimedia.org/wikipedia/en/4/4a/Oppenheimer_%28film%29.jpg',
    content:
      'Oppenheimer (3 hr): The story of American scientist, J. Robert Oppenheimer, and his role in the development of the atomic bomb. Biography, Drama, History film released in 2023. Directed by Christopher Nolan. Written by Christopher Nolan, Kai Bird and Martin Sherwin. Starring Cillian Murphy, Emily Blunt and Matt Damon. Rated 8.5 on IMDB',
  },
  {
    title: 'Barbie',
    releaseYear: '2023',
    runtimeMinutes: 114,
    poster: 'https://upload.wikimedia.org/wikipedia/en/0/0b/Barbie_2023_poster.jpg',
    content:
      'Barbie (1 hr 54 min): Barbie suffers a crisis that leads her to question her world and her existence. Adventure, Comedy, Fantasy film released in 2023. Directed by Greta Gerwig. Written by Greta Gerwig and Noah Baumbach. Starring Margot Robbie, Ryan Gosling and Issa Rae. Rated 7.0 on IMDB',
  },
  {
    title: 'Spider-Man: Across the Spider-Verse',
    releaseYear: '2023',
    runtimeMinutes: 140,
    poster:
      'https://upload.wikimedia.org/wikipedia/en/b/b4/Spider-Man-_Across_the_Spider-Verse_poster.jpg',
    content:
      'Spider-Man: Across the Spider-Verse (2 hr 20 min): Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence. When the heroes clash on how to handle a new threat, Miles must redefine what it means to be a hero. Animation, Action, Adventure film released in 2023. Directed by Joaquim Dos Santos, Kemp Powers an Justin K. Thompson. Written by Phil Lord, Christopher Miller and Dave Callaham. Starring: Shameik Moore, Hailee Steinfeld and Brian Tyree Henry. Rated 8.7 on IMDB',
  },
  {
    title: 'Pathaan',
    releaseYear: '2023',
    runtimeMinutes: 146,
    poster: 'https://upload.wikimedia.org/wikipedia/en/c/c3/Pathaan_film_poster.jpg',
    content:
      'Pathaan (2 hr 26 min): An Indian agent races against a doomsday clock as a ruthless mercenary, with a bitter vendetta, mounts an apocalyptic attack against the country. Bollywood action, adventure, triller film released in 2023. Directed by Siddharth Anand. Written by Shridhar Raghavan, Abbas Tyrewala and Siddharth Anand. Starring Shah Rukh Khan, Deepika Padukone and John Abraham. Rated 5.9 on IMDB',
  },
  {
    title: 'RRR',
    releaseYear: '2022',
    runtimeMinutes: 187,
    poster: 'https://upload.wikimedia.org/wikipedia/en/d/d7/RRR_Poster.jpg',
    content:
      'RRR (3 hr 7 min): A fictitious story about two legendary revolutionaries and their journey away from home before they started fighting for their country in the 1920s. South Indian action, drama film released in 2022. Directed by S. S. Rajamouli. Written by Vijayendra Prasad, S. S. Rajamouli and Sai Madhav Burra. Starring N. T. Rama Rao Jr., Ram Charan and Ajay Devgn. Rated 7.8 on IMDB',
  },
];
