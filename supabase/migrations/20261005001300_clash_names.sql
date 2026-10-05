-- duels are called "clashs" in the game
update public.daily_defs set label = 'Lance ou relève un clash' where key = 'duel1';
update public.daily_defs set label = 'Gagne un clash' where key = 'duelwin1';
update public.daily_defs set label = 'Fais un entraînement blind test' where key = 'train1';
update public.achievements set label = 'Clasheur', description = 'Clashs gagnés', titles = '{Clasheur,Oreille d''or,Shazam humain}' where key = 'duelist';
