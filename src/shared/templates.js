'use strict';
// Templates de ata embutidos (somente leitura; o usuário pode duplicar e editar).
// Cada seção: título + instrução para a IA. "acoes" (tarefas) é sempre gerado à parte.

const BUILTIN_TEMPLATES = [
  {
    id: 'auto', builtin: true, name: 'Automático',
    description: 'Serve para qualquer reunião.',
    sections: [
      { title: 'Resumo', instruction: 'Os pontos principais da conversa, em frases curtas.' },
      { title: 'Decisões', instruction: 'O que foi decidido ou aprovado. Deixe vazio se nada foi decidido.' },
      { title: 'Pontos em aberto', instruction: 'Dúvidas, riscos e assuntos que ficaram para depois.' },
    ],
  },
  {
    id: 'one-on-one', builtin: true, name: '1:1',
    description: 'Conversa individual entre gestor e pessoa do time.',
    sections: [
      { title: 'Como a pessoa está', instruction: 'Humor, carga de trabalho e bem-estar mencionados.' },
      { title: 'Progresso e conquistas', instruction: 'O que avançou desde a última conversa.' },
      { title: 'Bloqueios', instruction: 'O que está atrapalhando e quem pode ajudar.' },
      { title: 'Feedback', instruction: 'Feedbacks dados ou recebidos.' },
      { title: 'Desenvolvimento', instruction: 'Carreira, aprendizado e metas.' },
    ],
  },
  {
    id: 'standup', builtin: true, name: 'Daily / Stand-up',
    description: 'Acompanhamento rápido do time.',
    sections: [
      { title: 'O que foi feito', instruction: 'Por pessoa, o que foi concluído.' },
      { title: 'O que vem agora', instruction: 'Por pessoa, o que será feito a seguir.' },
      { title: 'Impedimentos', instruction: 'Bloqueios citados e quem vai resolver.' },
    ],
  },
  {
    id: 'client', builtin: true, name: 'Reunião com cliente',
    description: 'Vendas, acompanhamento de conta ou entrega.',
    sections: [
      { title: 'Contexto do cliente', instruction: 'Situação atual, objetivos e prioridades do cliente.' },
      { title: 'Necessidades e dores', instruction: 'Problemas e pedidos que o cliente trouxe.' },
      { title: 'Objeções e riscos', instruction: 'Preocupações, objeções, concorrentes citados.' },
      { title: 'Combinados', instruction: 'Acordos, valores, prazos e próximos passos combinados.' },
    ],
  },
  {
    id: 'interview', builtin: true, name: 'Entrevista',
    description: 'Processo seletivo ou entrevista com usuário.',
    sections: [
      { title: 'Sobre a pessoa', instruction: 'Experiência e contexto relevantes.' },
      { title: 'Pontos fortes', instruction: 'Evidências positivas citadas na conversa.' },
      { title: 'Pontos de atenção', instruction: 'Lacunas, riscos ou dúvidas.' },
      { title: 'Citações marcantes', instruction: 'Frases importantes, com quem falou.' },
    ],
  },
  {
    id: 'planning', builtin: true, name: 'Planejamento',
    description: 'Planejamento de projeto, sprint ou lançamento.',
    sections: [
      { title: 'Objetivo', instruction: 'O que se quer alcançar e como medir.' },
      { title: 'Escopo e prioridades', instruction: 'O que entra, o que fica de fora e a ordem.' },
      { title: 'Cronograma', instruction: 'Datas, marcos e dependências citados.' },
      { title: 'Riscos', instruction: 'Riscos e como serão tratados.' },
    ],
  },
];

module.exports = { BUILTIN_TEMPLATES };
