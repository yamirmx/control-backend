// 1. MODIFICAR LA RUTA PRINCIPAL (ejemplo /dashboard o /cuentas)
app.get('/dashboard', async (req, res) => {
  // ... tu código que verifica el token (si tienes auth)
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
      include: { 
        transacciones: { 
          orderBy: { fecha: 'desc' },
          take: 10 // <-- ESTA LÍNEA ES NUEVA. Limita la primera carga a 10.
        } 
      }
    });
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. AGREGAR ESTA RUTA NUEVA COMPLETAMENTE
// React llamará aquí cuando presiones "Cargar más"
app.get('/api/cuentas/:id/transacciones', async (req, res) => {
  const { id } = req.params;
  const skip = Number(req.query.skip) || 0; 
  const take = 10; 

  try {
    const nuevasTransacciones = await prisma.transaccion.findMany({
      where: { cuentaId: Number(id) },
      orderBy: { fecha: 'desc' },
      skip: skip,
      take: take
    });

    res.json(nuevasTransacciones);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
