# insol-web 0.2
Web-based insolation checker following GOST R 57795-2017

Eng: Insol — Rapid Insolation Analysis Tool for Russian Building Standards

Insolation analysis under Russian regulations is a critical part of architectural design that directly shapes how buildings and cities look and function. Insolation requirements determine the minimum distances between residential buildings, their orientation, and many other placement factors. In practice, insolation is one of the strongest constraints in residential development—comparable to fire safety regulations.

Insolation refers to direct sunlight exposure during a required normative period defined by sanitary regulations (SanPiN). Sunlight has a strong bactericidal effect, and only a specific UV spectrum is capable of neutralizing antibiotic-resistant bacteria. Historically, introducing insolation standards contributed to reducing diseases such as tuberculosis.

However, insolation analysis faces several challenges. Traditional methods rely on manual calculation, and while specialized software exists, both approaches have limitations: computations can take considerable time, and only a small group of trained specialists are capable of performing them. Most architects cannot independently conduct a compliant insolation study.

There is also a significant issue of verification. When a developer submits a project for approval, the insolation study effectively becomes a black box: the developer may claim the standards are met, and the calculation team may confirm it, yet intentional or unintentional errors remain possible. Another important need is the ability to quickly test design hypotheses. Architects and developers must be able to rapidly evaluate whether a proposed building volume can be placed within an existing urban context without violating surrounding insolation requirements.

Insol is designed to solve two core problems:

1. Provide fast, high-level, preliminary insolation checks for development proposals.
2. Allow architects and developers to quickly test design hypotheses and assess whether a given building volume can be constructed without violating insolation norms.
In addition, Insol supports editing and extending GIS data, since open-source OSM datasets are often incomplete.

Ru:

Расчёт инсоляции по нормам РФ — один из ключевых этапов проектирования, напрямую влияющий на архитектуру и формирование городской среды. Именно инсоляция определяет расстояния между жилыми зданиями, их ориентацию и множество других параметров планировки. Поэтому её можно считать одним из самых строгих ограничивающих факторов в жилищном строительстве, сопоставимым по значимости с противопожарными требованиями.

Инсоляция — это прямое воздействие солнечного света в течение нормативного периода, установленного СанПиН. Солнечная радиация обладает выраженным бактерицидным эффектом, и лишь определённый спектр ультрафиолетовых лучей способен уничтожать бактерии, устойчивые к антибиотикам. В своё время введение нормативов инсоляции стало одним из факторов снижения заболеваемости туберкулёзом.

При этом существует серьёзная проблема расчёта инсоляции. Традиционная методика ориентирована на ручные расчёты; существуют и специализированные программные комплексы. Однако оба подхода имеют недостатки: расчёты занимают значительное время, а выполнить их могут только немногие подготовленные специалисты. Большинство архитекторов не владеют методикой расчёта инсоляции.

Существует также проблема верификации. Когда застройщик подаёт проект на согласование, расчёты инсоляции фактически представляют собой «чёрный ящик»: заявляется, что нормы соблюдены, это подтверждается расчётчиками, но вероятность ошибки — умышленной или непреднамеренной — всё равно присутствует. Ещё одна важная задача — возможность быстрой проверки гипотез. Архитектору или девелоперу необходимо оперативно оценивать, допустимо ли размещение нового объёма в существующей застройке и нарушает ли он инсоляцию соседних зданий.

Insol создан для решения двух ключевых задач:

1. Быстрая предварительная высокоуровневая проверка инсоляции проектных решений.
2. Оперативная проверка гипотез архитектора или застройщика о возможности размещения нового строительного объёма.
Кроме того, Insol позволяет редактировать и дополнять ГИС-данные, поскольку открытые данные OSM нередко неполны.
