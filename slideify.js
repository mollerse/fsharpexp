var fs = require('fs');

var slides = fs.readFileSync('./slides.html');
var title = 'En F# trojansk hest – Erfaringer fra bruken av et F#-domene i en C#-kontekst';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;
