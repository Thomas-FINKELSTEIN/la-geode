// Données de démonstration partagées par la page d'aperçu et la page article
// (anciens produits réels, photos Unsplash provisoires). Supprimable quand
// le vrai catalogue sera rempli.
window.CATALOGUE_DEMO = {
  themes: {
    mineraux: {
      nom: "Minéraux",
      familles: [
        {
          id: "pierres-roulees", nom: "Pierres roulées",
          slogan: "Le secret du succès sur le bien-être et la zénitude du corps et de l'esprit.",
          articles: [
            { id: "demo-amethyste", nom: "Améthyste", prix: 5, description: "Pierre d'apaisement et d'équilibre, idéale pour retrouver le calme et favoriser un sommeil serein.", photo: "https://images.unsplash.com/photo-1567113463224-37cf03ba4577?q=80&w=1200&auto=format&fit=crop" },
            { id: "demo-quartz-rose", nom: "Quartz rose", prix: 4.5, description: "La pierre de la douceur et de l'amour, à garder près de soi.", photo: "https://images.unsplash.com/photo-1632980205460-e490e885e848?q=80&w=1200&auto=format&fit=crop" },
            { id: "demo-oeil-de-tigre", nom: "Œil de tigre", prix: 4.5, description: "Force, courage et protection au quotidien.", photo: "https://images.unsplash.com/photo-1621329109234-d7657d2f3846?q=80&w=1200&auto=format&fit=crop" },
            { id: "demo-bronzite", nom: "Bronzite", prix: 3.5, description: "Pierre d'harmonie, elle aide à prendre du recul." }
          ]
        },
        {
          id: "pierres-brutes", nom: "Pierres brutes",
          slogan: "Retrouvez l'équilibre brut dans son état naturel.",
          articles: [
            { id: "demo-cristal-roche", nom: "Cristal de roche AA", prix: 37.5, description: "Pointe naturelle de belle clarté, énergie universelle et amplificatrice.", photo: "https://images.unsplash.com/photo-1521133573892-e44906baee46?q=80&w=1200&auto=format&fit=crop" },
            { id: "demo-apophyllite", nom: "Apophyllite druse", prix: 34.95, description: "Druse scintillante, pièce de méditation par excellence.", photo: "https://images.unsplash.com/photo-1638768892257-8aec93a524e5?q=80&w=1200&auto=format&fit=crop" }
          ]
        },
        {
          id: "pieces-exception", nom: "Pièces d'exception",
          slogan: "Géodes, sphères et pièces de collection sur socle, pour les passionnés et les curieux.",
          articles: [
            { id: "demo-sphere-obsidienne", nom: "Sphère d'obsidienne 10,2 kg", prix: null, description: "Pièce de collection sur socle en bois — venez l'admirer au showroom.", photo: "https://images.unsplash.com/photo-1736449497832-6ae92abb8507?q=80&w=1200&auto=format&fit=crop" }
          ]
        },
        { id: "lampes-minerales", nom: "Lampes minérales", slogan: "Harmonisez votre espace en nettoyant énergétiquement votre environnement, naturellement.", articles: [] },
        { id: "galets", nom: "Galets", slogan: "La douceur de la pierre à glisser dans la poche ou à poser chez soi.", articles: [] }
      ]
    }
  }
};
